import { Command } from 'commander'
import type { Adapters } from '../config'
import { emit, table, type Io } from '../output'
import { confirmDestructive } from './_confirm'

export function dbCommand(adapters: Adapters, io: Io): Command {
  const db = new Command('db').description('Database (Postgres) operations')

  const project = new Command('project').description('Manage database projects')

  project
    .command('create <name>')
    .description('Create a new Neon project. Escape hatch — normally use `rando infra setup`.')
    .option('--region <region>', 'Region identifier (e.g. aws-us-east-2)')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(async (name: string, opts: { region?: string; yes: boolean; json: boolean }) => {
      io.stderr(
        'note: this is an escape-hatch command. For the Rando stack, `rando infra setup` creates the Neon project from rando.config.json.',
      )
      const ok = await confirmDestructive(io, opts, `Create a new Neon project named "${name}"?`)
      if (!ok) {
        io.stdout('aborted.')
        return
      }
      const result = await adapters.db().createProject({ name, region: opts.region })
      emit(io, opts.json, result, (p) => `created project: ${p.name} (${p.id})`)
    })

  project
    .command('list')
    .description('List database projects')
    .option('--json', 'Emit raw JSON', false)
    .action(async (opts: { json: boolean }) => {
      const projects = await adapters.db().listProjects()
      emit(io, opts.json, projects, (list) => table(list.map((p) => ({ id: p.id, name: p.name }))))
    })

  project
    .command('delete <projectId>')
    .description(
      'Delete a Neon project (all branches + data). Escape hatch — for the Rando project, prefer the Neon dashboard so you see exactly what you are nuking.',
    )
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(async (projectId: string, opts: { yes: boolean; json: boolean }) => {
      io.stderr(
        'note: this is an escape-hatch command. The Rando Neon project should be torn down via the Neon dashboard, not the CLI.',
      )
      const ok = await confirmDestructive(
        io,
        opts,
        `Delete db project "${projectId}" and all of its data?`,
      )
      if (!ok) {
        io.stdout('aborted.')
        return
      }
      await adapters.db().deleteProject({ projectId })
      emit(io, opts.json, { ok: true, projectId }, () => `deleted project: ${projectId}`)
    })

  db.addCommand(project)

  const branch = new Command('branch').description('Manage database branches')

  branch
    .command('create <projectId> <name>')
    .description('Create a branch under a project')
    .option('--from <branchId>', 'Source branch id to fork from')
    .option('--json', 'Emit raw JSON', false)
    .action(async (projectId: string, name: string, opts: { from?: string; json: boolean }) => {
      const b = await adapters.db().createBranch({ projectId, name, fromBranchId: opts.from })
      emit(io, opts.json, b, (br) => `created branch: ${br.name} (${br.id})`)
    })

  branch
    .command('list <projectId>')
    .description('List branches in a project')
    .option('--json', 'Emit raw JSON', false)
    .action(async (projectId: string, opts: { json: boolean }) => {
      const list = await adapters.db().listBranches({ projectId })
      emit(io, opts.json, list, (rows) =>
        table(
          rows.map((b) => ({
            id: b.id,
            name: b.name,
            parent: b.parentId ?? '',
            createdAt: b.createdAt,
          })),
        ),
      )
    })

  branch
    .command('delete <projectId> <branchId>')
    .description('Delete a database branch. Irreversible.')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(async (projectId: string, branchId: string, opts: { yes: boolean; json: boolean }) => {
      const ok = await confirmDestructive(
        io,
        opts,
        `Delete db branch "${branchId}" on project "${projectId}"?`,
      )
      if (!ok) {
        io.stdout('aborted.')
        return
      }
      await adapters.db().deleteBranch({ projectId, branchId })
      emit(io, opts.json, { ok: true, branchId }, () => `deleted branch: ${branchId}`)
    })

  db.addCommand(branch)

  db.command('connection-string <projectId> <branchId>')
    .description('Print a connection string for a branch')
    .option('--pooled', 'Return the pooled connection string', false)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (projectId: string, branchId: string, opts: { pooled: boolean; json: boolean }) => {
        const conn = await adapters
          .db()
          .getConnectionString({ projectId, branchId, pooled: opts.pooled })
        emit(io, opts.json, conn, (c) => c.url)
      },
    )

  db.command('extension-enable <projectId> <branchId> <extension>')
    .description('Enable a Postgres extension on a branch (e.g. postgis)')
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (projectId: string, branchId: string, extension: string, opts: { json: boolean }) => {
        await adapters.db().enableExtension({ projectId, branchId, extension })
        emit(
          io,
          opts.json,
          { ok: true, extension },
          () => `enabled extension "${extension}" on ${branchId}`,
        )
      },
    )

  return db
}
