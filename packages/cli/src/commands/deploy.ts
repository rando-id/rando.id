import { Command } from 'commander'
import type { Adapters } from '../config'
import type { DeployEnvScope } from '../domain/deploy'
import { NotFoundError } from '../domain/errors'
import { emit, table, type Io } from '../output'
import { confirmDestructive } from './_confirm'

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
  const deploy = new Command('deploy').description('Deploy / hosting operations')

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
      emit(io, opts.json, p, (x) => `created app: ${x.name} (${x.id})`)
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
        ),
      )
    })

  app
    .command('delete <name>')
    .description('Delete a deploy app (deployments + env + domains). Irreversible.')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(async (appName: string, opts: { yes: boolean; json: boolean }) => {
      const provider = adapters.deploy()
      const p = await provider.getProjectByName({ name: appName })
      if (!p) throw new NotFoundError('deploy app', appName)
      const ok = await confirmDestructive(
        io,
        opts,
        `Delete deploy app "${appName}" (${p.id}) and all its deployments?`,
      )
      if (!ok) {
        io.stdout('aborted.')
        return
      }
      await provider.deleteProject({ projectId: p.id })
      emit(io, opts.json, { ok: true, name: appName }, () => `deleted app: ${appName}`)
    })

  deploy.addCommand(app)

  const env = new Command('env').description('Manage env vars on a deploy app')

  env
    .command('set <app> <key> <value>')
    .description('Set an env var (encrypted) for the given scopes')
    .requiredOption('--scope <scopes>', `Comma-separated scopes: ${SCOPES.join('|')}`)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        projectName: string,
        key: string,
        value: string,
        opts: { scope: string; json: boolean },
      ) => {
        const provider = adapters.deploy()
        const p = await provider.getProjectByName({ name: projectName })
        if (!p) throw new NotFoundError('deploy app', projectName)
        const scopes = parseScopes(opts.scope)
        const v = await provider.setEnv({
          projectId: p.id,
          key,
          value,
          scopes,
        })
        emit(io, opts.json, v, (x) => `set ${x.key} (${x.scopes.join(',')}) on ${p.name}`)
      },
    )

  env
    .command('list <app>')
    .description('List env vars on a project (values are not returned)')
    .option('--json', 'Emit raw JSON', false)
    .action(async (projectName: string, opts: { json: boolean }) => {
      const provider = adapters.deploy()
      const p = await provider.getProjectByName({ name: projectName })
      if (!p) throw new NotFoundError('deploy app', projectName)
      const list = await provider.listEnv({ projectId: p.id })
      emit(io, opts.json, list, (rows) =>
        table(rows.map((v) => ({ key: v.key, scopes: v.scopes.join(',') }))),
      )
    })

  deploy.addCommand(env)

  const domain = new Command('domain').description('Manage domains on a deploy app')

  domain
    .command('add <app> <hostname>')
    .description('Add a custom domain to a project, optionally bound to a branch')
    .option('--branch <branch>', 'Git branch this domain follows (e.g. staging)')
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (projectName: string, hostname: string, opts: { branch?: string; json: boolean }) => {
        const provider = adapters.deploy()
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
          (x) => `added domain: ${x.name}${x.branch ? ` (branch: ${x.branch})` : ''}`,
        )
      },
    )

  domain
    .command('remove <app> <hostname>')
    .description('Remove a custom domain from a project')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (projectName: string, hostname: string, opts: { yes: boolean; json: boolean }) => {
        const provider = adapters.deploy()
        const p = await provider.getProjectByName({ name: projectName })
        if (!p) throw new NotFoundError('deploy app', projectName)
        const ok = await confirmDestructive(
          io,
          opts,
          `Remove domain "${hostname}" from project "${projectName}"?`,
        )
        if (!ok) {
          io.stdout('aborted.')
          return
        }
        await provider.removeDomain({ projectId: p.id, hostname })
        emit(io, opts.json, { ok: true, hostname }, () => `removed domain: ${hostname}`)
      },
    )

  deploy.addCommand(domain)

  return deploy
}
