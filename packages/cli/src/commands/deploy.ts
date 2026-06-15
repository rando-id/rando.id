import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { Command } from 'commander'
import type { Adapters } from '../config'
import type { DeployEnvScope, DeployProvider, Deployment } from '../domain/deploy'
import { NotFoundError } from '../domain/errors'
import { emit, table, type Io, type SelectChoice } from '../output'
import { loadSetupConfig, vercelProjectName } from '../setup-config'
import { confirmDestructive } from './_confirm'
import { askOr, pickOr } from './_interactive'

const DEFAULT_CONFIG_PATH = 'rando.config.json'
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

const SCOPES: DeployEnvScope[] = ['production', 'preview', 'development']

function parseScopes(raw: string): DeployEnvScope[] {
  return raw.split(',').map((s) => {
    const trimmed = s.trim() as DeployEnvScope
    if (!SCOPES.includes(trimmed)) {
      throw new Error(`Invalid scope "${trimmed}". Must be one of: ${SCOPES.join(', ')}`)
    }
    return trimmed
  })
}

export function deployCommand(adapters: Adapters, io: Io): Command {
  const { colors } = io
  const deploy = new Command('deploy').description('Deploy / hosting operations')

  // Loader for app-name select prompts. Apps in Vercel are projects.
  const appChoices = async (): Promise<SelectChoice<string>[]> => {
    const list = await adapters.deploy().listProjects()
    return list.map((p) => ({ name: p.name, value: p.name, description: p.id }))
  }

  const app = new Command('app').description('Manage deploy apps (one per app in the monorepo)')

  app
    .command('create <name>')
    .description('Create a new deploy app linked to a GitHub repo + root directory')
    .requiredOption('--root <path>', 'Repo-relative root directory (e.g. apps/api)')
    .requiredOption('--repo <owner/name>', 'GitHub repository to link')
    .option('--json', 'Emit raw JSON', false)
    .action(async (name: string, opts: { root: string; repo: string; json: boolean }) => {
      const p = await adapters.deploy().createProject({
        name,
        repo: opts.repo,
        rootDirectory: opts.root,
      })
      emit(
        io,
        opts.json,
        p,
        (x) =>
          `${colors.success('✓')} created app: ${colors.resource(x.name)} ${colors.hint(`(${x.id})`)}`,
      )
    })

  app
    .command('list')
    .description('List deploy apps')
    .option('--json', 'Emit raw JSON', false)
    .action(async (opts: { json: boolean }) => {
      const list = await adapters.deploy().listProjects()
      emit(io, opts.json, list, (rows) =>
        table(
          rows.map((p) => ({
            id: p.id,
            name: p.name,
            root: p.rootDirectory ?? '',
          })),
          colors,
        ),
      )
    })

  app
    .command('delete [name]')
    .description('Delete a deploy app (deployments + env + domains). Irreversible.')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(async (nameArg: string | undefined, opts: { yes: boolean; json: boolean }) => {
      const provider = adapters.deploy()
      const appName = await pickOr(io, nameArg, appChoices, 'Which app to delete?', 'name')
      const p = await provider.getProjectByName({ name: appName })
      if (!p) throw new NotFoundError('deploy app', appName)
      const ok = await confirmDestructive(
        io,
        opts,
        `Delete deploy app ${colors.resource(`"${appName}"`)} ${colors.hint(`(${p.id})`)} and all its deployments?`,
      )
      if (!ok) {
        io.stdout(colors.hint('aborted.'))
        return
      }
      await provider.deleteProject({ projectId: p.id })
      emit(
        io,
        opts.json,
        { ok: true, name: appName },
        () => `${colors.success('✓')} deleted app: ${colors.resource(appName)}`,
      )
    })

  deploy.addCommand(app)

  const env = new Command('env').description('Manage env vars on a deploy app')

  env
    .command('set [app] [key] [value]')
    .description('Set an env var (encrypted) for the given scopes')
    .requiredOption('--scope <scopes>', `Comma-separated scopes: ${SCOPES.join('|')}`)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        appArg: string | undefined,
        keyArg: string | undefined,
        valueArg: string | undefined,
        opts: { scope: string; json: boolean },
      ) => {
        const provider = adapters.deploy()
        const projectName = await pickOr(io, appArg, appChoices, 'Which app?', 'app')
        const key = await askOr(io, keyArg, 'Env var key:', 'key')
        const value = await askOr(io, valueArg, `Value for ${key}:`, 'value')
        const p = await provider.getProjectByName({ name: projectName })
        if (!p) throw new NotFoundError('deploy app', projectName)
        const scopes = parseScopes(opts.scope)
        const v = await provider.setEnv({
          projectId: p.id,
          key,
          value,
          scopes,
        })
        emit(
          io,
          opts.json,
          v,
          (x) =>
            `${colors.success('✓')} set ${colors.bold(x.key)} ${colors.hint(`(${x.scopes.join(',')})`)} on ${colors.resource(p.name)}`,
        )
      },
    )

  env
    .command('list [app]')
    .description('List env vars on a project (values are not returned)')
    .option('--json', 'Emit raw JSON', false)
    .action(async (appArg: string | undefined, opts: { json: boolean }) => {
      const provider = adapters.deploy()
      const projectName = await pickOr(io, appArg, appChoices, 'Which app?', 'app')
      const p = await provider.getProjectByName({ name: projectName })
      if (!p) throw new NotFoundError('deploy app', projectName)
      const list = await provider.listEnv({ projectId: p.id })
      emit(io, opts.json, list, (rows) =>
        table(
          rows.map((v) => ({ key: v.key, scopes: v.scopes.join(',') })),
          colors,
        ),
      )
    })

  deploy.addCommand(env)

  const domain = new Command('domain').description('Manage domains on a deploy app')

  domain
    .command('add [app] [hostname]')
    .description('Add a custom domain to a project, optionally bound to a branch')
    .option('--branch <branch>', 'Git branch this domain follows (e.g. staging)')
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        appArg: string | undefined,
        hostnameArg: string | undefined,
        opts: { branch?: string; json: boolean },
      ) => {
        const provider = adapters.deploy()
        const projectName = await pickOr(io, appArg, appChoices, 'Which app?', 'app')
        const hostname = await askOr(io, hostnameArg, 'Hostname to add:', 'hostname')
        const p = await provider.getProjectByName({ name: projectName })
        if (!p) throw new NotFoundError('deploy app', projectName)
        const d = await provider.addDomain({
          projectId: p.id,
          hostname,
          branch: opts.branch,
        })
        emit(
          io,
          opts.json,
          d,
          (x) =>
            `${colors.success('✓')} added domain: ${colors.resource(x.name)}${x.branch ? ` ${colors.hint(`(branch: ${x.branch})`)}` : ''}`,
        )
      },
    )

  domain
    .command('remove [app] [hostname]')
    .description('Remove a custom domain from a project')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        appArg: string | undefined,
        hostnameArg: string | undefined,
        opts: { yes: boolean; json: boolean },
      ) => {
        const provider = adapters.deploy()
        const projectName = await pickOr(io, appArg, appChoices, 'Which app?', 'app')
        const hostname = await askOr(io, hostnameArg, 'Hostname to remove:', 'hostname')
        const p = await provider.getProjectByName({ name: projectName })
        if (!p) throw new NotFoundError('deploy app', projectName)
        const ok = await confirmDestructive(
          io,
          opts,
          `Remove domain ${colors.resource(`"${hostname}"`)} from app ${colors.resource(`"${projectName}"`)}?`,
        )
        if (!ok) {
          io.stdout(colors.hint('aborted.'))
          return
        }
        await provider.removeDomain({ projectId: p.id, hostname })
        emit(
          io,
          opts.json,
          { ok: true, hostname },
          () => `${colors.success('✓')} removed domain: ${colors.resource(hostname)}`,
        )
      },
    )

  deploy.addCommand(domain)

  deploy
    .command('teardown [branch]')
    .description(
      'Inverse of `deploy branch --stable-url`: per app, remove the custom Vercel domain and the Cloudflare CNAME for the given branch. Idempotent — safe to run from a PR-close GitHub Actions job.',
    )
    .option('--apps <names>', 'Comma-separated app names (default: all apps in config)', '')
    .option(
      '--config <path>',
      'Path to rando.config.json (default: repo root)',
      DEFAULT_CONFIG_PATH,
    )
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        branchArg: string | undefined,
        opts: { apps: string; config: string; yes: boolean; json: boolean },
      ) => {
        const branch = branchArg ?? getCurrentGitBranch()
        const configPath = resolve(process.cwd(), opts.config)
        const config = loadSetupConfig(configPath)
        const requested = opts.apps ? opts.apps.split(',').map((s) => s.trim()) : []
        const apps = requested.length
          ? config.apps.filter((a) => requested.includes(a.name))
          : config.apps
        if (apps.length === 0) {
          throw new Error(
            `No matching apps in config. Requested: ${requested.join(', ')}. ` +
              `Available: ${config.apps.map((a) => a.name).join(', ')}`,
          )
        }

        const slug = slugifyBranch(branch)
        io.stdout(`${colors.hint('branch:')} ${colors.resource(branch)}`)
        io.stdout(`${colors.hint('apps:')}   ${apps.map((a) => a.name).join(', ')}`)
        io.stdout(
          `${colors.hint('tearing down:')} ${colors.resource(`${slug}-<app>.${config.domains.nonProd}`)}`,
        )
        io.stdout('')

        const ok = await confirmDestructive(
          io,
          opts,
          `Remove stable URLs for branch ${colors.resource(`"${branch}"`)} across ${apps.length} app${apps.length === 1 ? '' : 's'}?`,
        )
        if (!ok) {
          io.stdout(colors.hint('aborted.'))
          return
        }

        const summary = await teardownStableUrls(io, config, branch, apps, adapters)
        io.stdout('')
        if (opts.json) {
          io.stdout(JSON.stringify(summary, null, 2))
        } else {
          for (const r of summary) {
            const dnsLabel = r.dnsRemoved ? colors.success('dns ✓') : colors.hint('dns —')
            const domLabel = r.domainRemoved ? colors.success('vercel ✓') : colors.hint('vercel —')
            io.stdout(
              `  ${colors.resource(r.app.padEnd(8))} ${domLabel}  ${dnsLabel}  ${colors.hint(r.hostname)}`,
            )
          }
        }
      },
    )

  deploy
    .command('branch [branch]')
    .description('Trigger Vercel preview deploys for each configured app on a git branch')
    .option('--apps <names>', 'Comma-separated app names (default: all apps in config)', '')
    .option(
      '--config <path>',
      'Path to rando.config.json (default: repo root)',
      DEFAULT_CONFIG_PATH,
    )
    .option('--no-wait', 'Trigger and exit without polling for ready state')
    .option(
      '-s, --stable-url',
      'After ready, set up stable <branch-slug>-<app>.<nonProd> CNAMEs that follow the branch',
      false,
    )
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        branchArg: string | undefined,
        opts: {
          apps: string
          config: string
          wait: boolean
          stableUrl: boolean
          json: boolean
        },
      ) => {
        const branch = branchArg ?? getCurrentGitBranch()
        const configPath = resolve(process.cwd(), opts.config)
        const config = loadSetupConfig(configPath)
        const requested = opts.apps ? opts.apps.split(',').map((s) => s.trim()) : []
        const apps = requested.length
          ? config.apps.filter((a) => requested.includes(a.name))
          : config.apps
        if (apps.length === 0) {
          throw new Error(
            `No matching apps in config. Requested: ${requested.join(', ')}. ` +
              `Available: ${config.apps.map((a) => a.name).join(', ')}`,
          )
        }

        io.stdout(`${colors.hint('branch:')} ${colors.resource(branch)}`)
        io.stdout(`${colors.hint('apps:')}   ${apps.map((a) => a.name).join(', ')}`)
        if (opts.stableUrl) {
          io.stdout(
            `${colors.hint('stable urls:')} ${colors.resource(`<${slugifyBranch(branch)}>-<app>.${config.domains.nonProd}`)}`,
          )
        }
        io.stdout('')

        const provider = adapters.deploy()

        // Trigger every app's deployment in parallel — the API calls are
        // independent and each one returns a deployment id immediately.
        const sp = io.spinner(`Triggering ${apps.length} deployments…`)
        const triggered = await Promise.all(
          apps.map(async (app) => {
            const projectName = vercelProjectName(config, app)
            const project = await provider.getProjectByName({ name: projectName })
            if (!project) throw new NotFoundError('deploy app', projectName)
            const deployment = await provider.triggerDeployment({
              projectId: project.id,
              branch,
            })
            return { projectName, deployment }
          }),
        )
        sp.succeed(`Triggered ${apps.length} deployments`)

        if (opts.wait === false) {
          io.stdout('')
          emitBranchResults(io, triggered, opts.json, 'triggered')
          return
        }

        // Poll each deployment in parallel and update a single shared spinner
        // with completion progress. Sequential polling would block on the
        // slowest build for every other app.
        let completed = 0
        const waitSp = io.spinner(`Building 0/${triggered.length}…`)
        const results = await Promise.all(
          triggered.map(async (t) => {
            const final = await pollUntilSettled(provider, t.deployment.id)
            completed += 1
            waitSp.setText(`Building ${completed}/${triggered.length}…`)
            return { projectName: t.projectName, deployment: final }
          }),
        )
        const anyFailed = results.some((r) => r.deployment.state !== 'ready')
        if (anyFailed) waitSp.fail(`Finished — some deployments failed`)
        else waitSp.succeed(`All ${triggered.length} deployments ready`)

        // Stable URL setup happens AFTER deployments are ready so we
        // don't create a CNAME pointing at a broken build.
        let stableUrls: Record<string, string> = {}
        if (opts.stableUrl && !anyFailed) {
          stableUrls = await setupStableUrls(io, config, branch, apps, adapters)
        }

        io.stdout('')
        emitBranchResults(io, results, opts.json, 'ready', stableUrls)
      },
    )

  return deploy
}

function getCurrentGitBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim()
  } catch {
    throw new Error(
      'Could not determine current git branch — pass one explicitly: `rando deploy branch <branch>`.',
    )
  }
}

async function pollUntilSettled(
  provider: DeployProvider,
  deploymentId: string,
): Promise<Deployment> {
  const start = Date.now()
  while (true) {
    const d = await provider.getDeployment({ deploymentId })
    if (d.state === 'ready' || d.state === 'error' || d.state === 'canceled') return d
    if (Date.now() - start > POLL_TIMEOUT_MS) {
      throw new Error(
        `Polling deployment ${deploymentId} timed out after ${POLL_TIMEOUT_MS / 1000}s — ` +
          'check the Vercel dashboard for build status.',
      )
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

function emitBranchResults(
  io: Io,
  results: Array<{ projectName: string; deployment: Deployment }>,
  asJson: boolean,
  verb: 'triggered' | 'ready',
  stableUrls: Record<string, string> = {},
): void {
  if (asJson) {
    io.stdout(
      JSON.stringify(
        results.map((r) => ({
          app: r.projectName,
          ...r.deployment,
          url: `https://${r.deployment.url}`,
          stableUrl: stableUrls[r.projectName] ?? null,
        })),
        null,
        2,
      ),
    )
    return
  }
  const { colors } = io
  const widest = Math.max(...results.map((r) => r.projectName.length))
  for (const r of results) {
    const url = `https://${r.deployment.url}`
    const status =
      r.deployment.state === 'ready'
        ? colors.success(`✓ ${verb}`)
        : r.deployment.state === 'building' || r.deployment.state === 'queued'
          ? colors.warn(`• ${r.deployment.state}`)
          : colors.error(`✗ ${r.deployment.state}`)
    io.stdout(`  ${colors.resource(r.projectName.padEnd(widest))}  ${status}  ${colors.hint(url)}`)
    const stable = stableUrls[r.projectName]
    if (stable) {
      io.stdout(`  ${' '.repeat(widest)}  ${colors.hint('  stable:')}  ${colors.resource(stable)}`)
    }
  }
}

/**
 * Convert a git branch name to a DNS-safe slug. Branches like `feat/foo`
 * have slashes that aren't valid in hostnames; this normalizes to
 * lowercase + hyphens.
 */
function slugifyBranch(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Inverse of setupStableUrls. For each app, remove the Vercel custom
 * domain and the Cloudflare CNAME that --stable-url created. Both
 * operations are idempotent: missing resources are treated as "already
 * gone" rather than errors.
 */
async function teardownStableUrls(
  io: Io,
  config: { project: string; domains: { nonProd: string }; apps: Array<{ name: string }> },
  branch: string,
  apps: Array<{ name: string }>,
  adapters: Adapters,
): Promise<Array<{ app: string; hostname: string; domainRemoved: boolean; dnsRemoved: boolean }>> {
  const { colors } = io
  const slug = slugifyBranch(branch)
  const zone = config.domains.nonProd
  const deploy = adapters.deploy()
  const dns = adapters.dns()

  const sp = io.spinner(`Tearing down stable URLs for ${apps.length} apps…`)

  let existingRecords: Array<{ id: string; name: string }> = []
  try {
    existingRecords = await dns.listRecords({ zone })
  } catch (e) {
    io.stdout(
      `  ${colors.warn('⚠')} failed to list DNS records for ${colors.resource(zone)}: ${(e as Error).message ?? e} — DNS cleanup skipped`,
    )
  }

  const out: Array<{
    app: string
    hostname: string
    domainRemoved: boolean
    dnsRemoved: boolean
  }> = []

  for (const app of apps) {
    const projectName = `${config.project}-${app.name}`
    const hostname = `${slug}-${app.name}.${zone}`
    let domainRemoved = false
    let dnsRemoved = false

    try {
      const project = await deploy.getProjectByName({ name: projectName })
      if (project) {
        try {
          await deploy.removeDomain({ projectId: project.id, hostname })
          domainRemoved = true
        } catch (e) {
          // 404 / not-found = already gone; anything else surfaces as a warning
          const status = (e as { status?: number }).status
          const body = String((e as { body?: string }).body ?? e)
          if (status !== 404 && !/not.?found/i.test(body)) {
            io.stdout(
              `  ${colors.warn('⚠')} ${colors.resource(projectName)} vercel: ${(e as Error).message ?? e}`,
            )
          }
        }
      }

      const record = existingRecords.find((r) => r.name === hostname)
      if (record) {
        await dns.removeRecord({ zone, recordId: record.id })
        dnsRemoved = true
      }
    } catch (e) {
      io.stdout(
        `  ${colors.warn('⚠')} ${colors.resource(projectName)} teardown failed: ${(e as Error).message ?? e}`,
      )
    }

    out.push({ app: projectName, hostname, domainRemoved, dnsRemoved })
  }

  sp.succeed(`Teardown complete`)
  return out
}

/**
 * Ensure a Vercel custom domain + Cloudflare CNAME exist for each app on
 * `<branchSlug>-<app>.<nonProd>`. Both calls are idempotent: existing
 * records are detected and skipped. Returns a map of projectName →
 * stable URL for results display.
 */
async function setupStableUrls(
  io: Io,
  config: { project: string; domains: { nonProd: string }; apps: Array<{ name: string }> },
  branch: string,
  apps: Array<{ name: string }>,
  adapters: Adapters,
): Promise<Record<string, string>> {
  const { colors } = io
  const slug = slugifyBranch(branch)
  const zone = config.domains.nonProd
  const deploy = adapters.deploy()
  const dns = adapters.dns()

  const sp = io.spinner(`Setting up stable URLs for ${apps.length} apps…`)
  const out: Record<string, string> = {}

  // Fetch existing DNS records once so each app's add-or-skip is one call.
  let existingRecords: Array<{ name: string }> = []
  try {
    existingRecords = await dns.listRecords({ zone })
  } catch (e) {
    io.stdout(
      `  ${colors.warn('⚠')} failed to list DNS records for ${colors.resource(zone)}: ${(e as Error).message ?? e} — duplicates may be created`,
    )
  }

  for (const app of apps) {
    const projectName = `${config.project}-${app.name}`
    const subdomain = `${slug}-${app.name}`
    const hostname = `${subdomain}.${zone}`

    try {
      const project = await deploy.getProjectByName({ name: projectName })
      if (!project) {
        sp.warn(`vercel project "${projectName}" not found — skipping stable URL`)
        sp.setText(`Setting up stable URLs for ${apps.length} apps…`)
        continue
      }
      try {
        await deploy.addDomain({ projectId: project.id, hostname, branch })
      } catch (e) {
        // 409 = already exists; treat as success since branch wiring matches.
        const status = (e as { status?: number }).status
        if (status !== 409 && !/already/i.test(String(e))) throw e
      }
      const alreadyHasDns = existingRecords.some((r) => r.name === hostname || r.name === subdomain)
      if (!alreadyHasDns) {
        await dns.addRecord({
          zone,
          type: 'CNAME',
          name: subdomain,
          content: 'cname.vercel-dns.com',
        })
      }
      out[projectName] = `https://${hostname}`
    } catch (e) {
      io.stdout(
        `  ${colors.warn('⚠')} ${colors.resource(projectName)} — could not set up stable URL: ${(e as Error).message ?? e}`,
      )
    }
  }

  sp.succeed(`Stable URLs ready (${Object.keys(out).length}/${apps.length})`)
  return out
}
