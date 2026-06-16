// End-to-end infrastructure orchestration. Pure: takes providers as
// dependencies, emits status events instead of writing directly to stdout
// so it's easy to test.
//
// Idempotent by design — every step checks "does this already exist?"
// before creating, and re-running is safe.

import type { DbProvider } from './domain/db'
import type { DeployProvider } from './domain/deploy'
import type { DnsProvider } from './domain/dns'
import type { TunnelProvider } from './domain/tunnel'
import type { VercelCliProvisioner } from './domain/vercel-cli'
import { ProviderApiError } from './domain/errors'
import { hostnameFor, vercelProjectName, type SetupConfig, type SetupEnv } from './setup-config'

/** Vercel always serves custom-domain traffic via this CNAME. */
const VERCEL_CNAME_TARGET = 'cname.vercel-dns.com'

/** A single status event the orchestrator emits as it progresses. */
export type SetupEvent =
  | { kind: 'step-start'; message: string }
  | { kind: 'step-skip'; message: string }
  | { kind: 'step-done'; message: string }
  | { kind: 'note'; message: string }

export interface OrchestratorDeps {
  db: DbProvider
  tunnel: TunnelProvider
  deploy: DeployProvider
  dns: DnsProvider
  /**
   * Only invoked when `config.db?.managedBy === 'vercel'`. Provisions
   * the Neon project via `vercel install neon` since direct Neon API
   * creates are blocked on Vercel-managed orgs.
   */
  vercelCli: VercelCliProvisioner
}

export interface OrchestratorOptions {
  config: SetupConfig
  envs: SetupEnv[]
  apps: string[] // app names; empty = all
  emit: (event: SetupEvent) => void
}

/**
 * Run the full setup for the requested envs + apps. Each phase below is
 * independently idempotent, so partial reruns work after an outage.
 */
export async function runSetup(
  deps: OrchestratorDeps,
  options: OrchestratorOptions,
): Promise<void> {
  const { config, envs, emit } = options
  const apps = filterApps(config, options.apps)

  if (envs.includes('dev')) {
    await setupDev(deps, config, apps, emit)
  }
  if (envs.includes('staging') || envs.includes('production')) {
    await setupDatabase(deps, config, envs, emit)
  }
  if (envs.includes('staging')) {
    await setupVercelEnv(deps, config, 'staging', apps, emit)
  }
  if (envs.includes('production')) {
    await setupVercelEnv(deps, config, 'production', apps, emit)
  }
}

// --- env-specific phases --------------------------------------------------

async function setupDev(
  deps: OrchestratorDeps,
  config: SetupConfig,
  apps: SetupConfig['apps'],
  emit: (event: SetupEvent) => void,
): Promise<void> {
  emit({ kind: 'step-start', message: `tunnel: ensuring "${config.tunnel}" exists` })
  let tunnel = await deps.tunnel.getTunnelByName({ name: config.tunnel })
  if (tunnel) {
    emit({ kind: 'step-skip', message: `tunnel "${config.tunnel}" already exists (${tunnel.id})` })
  } else {
    tunnel = await deps.tunnel.createTunnel({ name: config.tunnel })
    emit({ kind: 'step-done', message: `tunnel "${tunnel.name}" created (${tunnel.id})` })
    emit({
      kind: 'note',
      message: `tunnel token: run \`rando tunnel token ${config.tunnel}\` to copy it into your repo-root .env as CLOUDFLARE_TUNNEL_TOKEN`,
    })
  }

  const existingRoutes = await deps.tunnel.listRoutes({ tunnelId: tunnel.id })
  const existingHosts = new Set(existingRoutes.map((r) => r.hostname))
  for (const app of apps) {
    const hostname = hostnameFor(config, 'dev', app)
    const service = `http://host.docker.internal:${app.port}`
    if (existingHosts.has(hostname)) {
      emit({ kind: 'step-skip', message: `tunnel route ${hostname} already exists` })
      continue
    }
    await deps.tunnel.addRoute({ tunnelId: tunnel.id, hostname, service })
    emit({ kind: 'step-done', message: `tunnel route ${hostname} → ${service}` })
  }
}

async function setupDatabase(
  deps: OrchestratorDeps,
  config: SetupConfig,
  envs: SetupEnv[],
  emit: (event: SetupEvent) => void,
): Promise<void> {
  emit({ kind: 'step-start', message: `db: ensuring project "${config.project}" exists` })
  const projects = await deps.db.listProjects()
  let project = projects.find((p) => p.name === config.project)
  if (project) {
    emit({
      kind: 'step-skip',
      message: `db project "${config.project}" already exists (${project.id})`,
    })
  } else if (config.db?.managedBy === 'vercel') {
    // Vercel-managed Neon orgs reject direct API creates
    // ("action restricted; reason: organization is managed by Vercel").
    // Route project creation through `vercel install neon`, then
    // re-lookup via the Neon API.
    const plan = config.db.plan ?? 'free'
    emit({
      kind: 'step-start',
      message: `db: provisioning "${config.project}" via vercel install neon (plan=${plan})`,
    })
    await deps.vercelCli.installNeon({
      name: config.project,
      plan,
      envs: ['production', 'preview'],
    })
    const refreshed = await deps.db.listProjects()
    project = refreshed.find((p) => p.name === config.project)
    if (!project) {
      throw new ProviderApiError(
        'orchestrator',
        500,
        'vercel install neon completed but project not visible to Neon API',
        `expected project "${config.project}" to appear after \`vercel install neon\` — check the Vercel dashboard`,
      )
    }
    emit({
      kind: 'step-done',
      message: `db project "${project.name}" provisioned via Vercel (${project.id})`,
    })
  } else {
    project = await deps.db.createProject({ name: config.project })
    emit({ kind: 'step-done', message: `db project "${project.name}" created (${project.id})` })
  }

  const branches = await deps.db.listBranches({ projectId: project.id })
  const main = branches.find((b) => b.name === 'main') ?? branches[0]
  if (!main) {
    throw new ProviderApiError(
      'orchestrator',
      500,
      'no branches on project',
      `db project ${project.name} has no branches — Neon should always have a main; recreate the project`,
    )
  }

  // Enable PostGIS on main (idempotent at the SQL layer thanks to IF NOT EXISTS).
  // Soft-fail: Neon's REST API has no SQL-execution endpoint (see #79).
  // The orchestrator emits a manual-setup note and continues so the rest
  // of the flow (deploy projects, DNS, etc.) isn't blocked.
  if (envs.includes('production')) {
    await tryEnableExtension(deps, project.id, main.id, 'main', emit)
  }

  // staging branch
  if (envs.includes('staging')) {
    let staging = branches.find((b) => b.name === 'staging')
    if (staging) {
      emit({ kind: 'step-skip', message: `db branch "staging" already exists (${staging.id})` })
    } else {
      staging = await deps.db.createBranch({
        projectId: project.id,
        name: 'staging',
        fromBranchId: main.id,
      })
      emit({ kind: 'step-done', message: `db branch "staging" created (${staging.id})` })
    }
    await tryEnableExtension(deps, project.id, staging.id, 'staging', emit)
  }
}

/**
 * Best-effort PostGIS enable. The Neon REST API doesn't actually have
 * a SQL-execution endpoint (see #79 for the proper fix that uses
 * @neondatabase/serverless). Until that lands, we attempt the call and
 * fall back to a clear "run this manually" note so the orchestrator
 * doesn't block the rest of setup.
 */
async function tryEnableExtension(
  deps: OrchestratorDeps,
  projectId: string,
  branchId: string,
  branchName: string,
  emit: (event: SetupEvent) => void,
): Promise<void> {
  try {
    await deps.db.enableExtension({ projectId, branchId, extension: 'postgis' })
    emit({ kind: 'step-done', message: `db branch "${branchName}" — postgis enabled` })
  } catch (e) {
    emit({
      kind: 'note',
      message:
        `postgis on "${branchName}" not auto-enabled — Neon API doesn't expose SQL execution (#79). ` +
        `Connect via psql and run: CREATE EXTENSION IF NOT EXISTS "postgis";` +
        (e instanceof Error ? `  (underlying: ${e.message})` : ''),
    })
  }
}

async function setupVercelEnv(
  deps: OrchestratorDeps,
  config: SetupConfig,
  env: 'staging' | 'production',
  apps: SetupConfig['apps'],
  emit: (event: SetupEvent) => void,
): Promise<void> {
  const branch = env === 'staging' ? 'staging' : 'main'
  for (const app of apps) {
    const projectName = vercelProjectName(config, app)
    emit({ kind: 'step-start', message: `vercel: ensuring "${projectName}" exists` })
    let project = await deps.deploy.getProjectByName({ name: projectName })
    if (project) {
      emit({
        kind: 'step-skip',
        message: `vercel project "${projectName}" already exists (${project.id})`,
      })
    } else {
      project = await deps.deploy.createProject({
        name: projectName,
        repo: config.repo,
        rootDirectory: app.rootDirectory,
      })
      emit({
        kind: 'step-done',
        message: `vercel project "${projectName}" created (${project.id})`,
      })
    }

    const hostname = hostnameFor(config, env, app)
    try {
      await deps.deploy.addDomain({
        projectId: project.id,
        hostname,
        branch: env === 'staging' ? branch : undefined,
      })
      emit({
        kind: 'step-done',
        message: `vercel domain ${hostname}${env === 'staging' ? ` → branch ${branch}` : ''}`,
      })
    } catch (e) {
      if (e instanceof ProviderApiError && (e.status === 409 || /already/i.test(e.body))) {
        emit({ kind: 'step-skip', message: `vercel domain ${hostname} already configured` })
      } else {
        throw e
      }
    }

    // Add the matching CNAME to Cloudflare so the domain resolves to Vercel.
    const zone = env === 'staging' ? config.domains.nonProd : config.domains.production
    const recordName = dnsRecordNameFor(env, app, config, hostname)
    try {
      const existing = await deps.dns.listRecords({ zone })
      const already = existing.find((r) => r.name === hostname || r.name === recordName)
      if (already) {
        emit({ kind: 'step-skip', message: `dns ${hostname} already exists` })
      } else {
        await deps.dns.addRecord({
          zone,
          type: 'CNAME',
          name: recordName,
          content: VERCEL_CNAME_TARGET,
        })
        emit({ kind: 'step-done', message: `dns CNAME ${hostname} → ${VERCEL_CNAME_TARGET}` })
      }
    } catch (e) {
      if (e instanceof ProviderApiError) {
        emit({
          kind: 'note',
          message: `dns step failed for ${hostname}: ${e.message}; you may need to add this CNAME by hand`,
        })
      } else {
        throw e
      }
    }
  }
}

// --- destroy --------------------------------------------------------------

/** Raised when the user asks the CLI to tear down production. */
export class ProductionDestroyForbiddenError extends Error {
  constructor() {
    super(
      'Refusing to destroy production from the CLI. Production teardown is ' +
        'irreversible — do it by hand in the Neon, Vercel, and Cloudflare ' +
        'dashboards so you see exactly what you are deleting.',
    )
    this.name = 'ProductionDestroyForbiddenError'
  }
}

export interface DestroyOptions {
  config: SetupConfig
  /** Single env. Destroy is intentionally one-env-at-a-time. */
  env: SetupEnv
  apps: string[]
  emit: (event: SetupEvent) => void
}

/**
 * Inverse of `runSetup` for a single env. Each phase is idempotent — missing
 * resources emit `step-skip` rather than failing. Production always throws.
 */
export async function runDestroy(deps: OrchestratorDeps, options: DestroyOptions): Promise<void> {
  if (options.env === 'production') {
    throw new ProductionDestroyForbiddenError()
  }
  const apps = filterApps(options.config, options.apps)
  if (options.env === 'dev') {
    await destroyDev(deps, options.config, apps, options.emit)
  }
  if (options.env === 'staging') {
    await destroyStaging(deps, options.config, apps, options.emit)
  }
}

async function destroyDev(
  deps: OrchestratorDeps,
  config: SetupConfig,
  apps: SetupConfig['apps'],
  emit: (event: SetupEvent) => void,
): Promise<void> {
  emit({ kind: 'step-start', message: `tunnel: locating "${config.tunnel}"` })
  const tunnel = await deps.tunnel.getTunnelByName({ name: config.tunnel })
  if (!tunnel) {
    emit({ kind: 'step-skip', message: `tunnel "${config.tunnel}" already absent` })
    return
  }

  // Remove this run's app routes first — keeps the "what got removed" output
  // explicit even though `deleteTunnel` cascades.
  const routes = await deps.tunnel.listRoutes({ tunnelId: tunnel.id })
  for (const app of apps) {
    const hostname = hostnameFor(config, 'dev', app)
    const route = routes.find((r) => r.hostname === hostname)
    if (!route) {
      emit({ kind: 'step-skip', message: `tunnel route ${hostname} already absent` })
      continue
    }
    await deps.tunnel.removeRoute({ tunnelId: tunnel.id, routeId: route.id })
    emit({ kind: 'step-done', message: `tunnel route ${hostname} removed` })
  }

  await deps.tunnel.deleteTunnel({ tunnelId: tunnel.id })
  emit({ kind: 'step-done', message: `tunnel "${tunnel.name}" deleted (${tunnel.id})` })
}

async function destroyStaging(
  deps: OrchestratorDeps,
  config: SetupConfig,
  apps: SetupConfig['apps'],
  emit: (event: SetupEvent) => void,
): Promise<void> {
  // Vercel + DNS first — they reference per-app projects/records. Neon branch
  // last so the data hangs around if anything earlier fails midway.
  for (const app of apps) {
    const hostname = hostnameFor(config, 'staging', app)
    const projectName = vercelProjectName(config, app)
    emit({ kind: 'step-start', message: `vercel: removing ${hostname} from "${projectName}"` })
    const project = await deps.deploy.getProjectByName({ name: projectName })
    if (!project) {
      emit({ kind: 'step-skip', message: `vercel project "${projectName}" already absent` })
    } else {
      try {
        await deps.deploy.removeDomain({ projectId: project.id, hostname })
        emit({
          kind: 'step-done',
          message: `vercel domain ${hostname} removed from "${projectName}"`,
        })
      } catch (e) {
        if (e instanceof ProviderApiError && (e.status === 404 || /not.?found/i.test(e.body))) {
          emit({ kind: 'step-skip', message: `vercel domain ${hostname} already absent` })
        } else {
          throw e
        }
      }
    }

    const zone = config.domains.nonProd
    try {
      const existing = await deps.dns.listRecords({ zone })
      const record = existing.find((r) => r.name === hostname)
      if (!record) {
        emit({ kind: 'step-skip', message: `dns ${hostname} already absent` })
      } else {
        await deps.dns.removeRecord({ zone, recordId: record.id })
        emit({ kind: 'step-done', message: `dns ${hostname} removed` })
      }
    } catch (e) {
      if (e instanceof ProviderApiError) {
        emit({
          kind: 'note',
          message: `dns step failed for ${hostname}: ${e.message}; you may need to remove this record by hand`,
        })
      } else {
        throw e
      }
    }
  }

  emit({ kind: 'step-start', message: `db: locating project "${config.project}"` })
  const projects = await deps.db.listProjects()
  const project = projects.find((p) => p.name === config.project)
  if (!project) {
    emit({ kind: 'step-skip', message: `db project "${config.project}" already absent` })
    return
  }
  const branches = await deps.db.listBranches({ projectId: project.id })
  const staging = branches.find((b) => b.name === 'staging')
  if (!staging) {
    emit({ kind: 'step-skip', message: `db branch "staging" already absent` })
    return
  }
  await deps.db.deleteBranch({ projectId: project.id, branchId: staging.id })
  emit({ kind: 'step-done', message: `db branch "staging" deleted (${staging.id})` })
}

// --- helpers --------------------------------------------------------------

function filterApps(config: SetupConfig, names: string[]): SetupConfig['apps'] {
  if (names.length === 0) return config.apps
  const allowed = new Set(names)
  const filtered = config.apps.filter((a) => allowed.has(a.name))
  if (filtered.length === 0) {
    throw new Error(
      `No apps in config match the requested names: ${names.join(', ')}. ` +
        `Available: ${config.apps.map((a) => a.name).join(', ')}`,
    )
  }
  return filtered
}

/** Cloudflare DNS uses the short subdomain ("staging-api") or "@" for apex. */
function dnsRecordNameFor(
  env: 'staging' | 'production',
  app: SetupConfig['apps'][number],
  config: SetupConfig,
  fullHostname: string,
): string {
  if (env === 'production' && app.prodApex) return '@'
  // Strip the zone suffix off the full hostname → subdomain only.
  const zone = env === 'staging' ? config.domains.nonProd : config.domains.production
  if (fullHostname === zone) return '@'
  const suffix = `.${zone}`
  return fullHostname.endsWith(suffix) ? fullHostname.slice(0, -suffix.length) : fullHostname
}
