import { resolve } from 'node:path'
import { Command } from 'commander'
import type { Adapters } from '../config'
import { NotFoundError } from '../domain/errors'
import { emit, table, type Io } from '../output'
import { loadSetupConfig } from '../setup-config'
import { confirmDestructive } from './_confirm'

const DEFAULT_CONFIG_PATH = 'rando.config.json'

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
        io.colors.warn(
          'note: this is an escape-hatch command. For the Rando stack, `rando infra setup` creates the Neon project from rando.config.json.',
        ),
      )
      const ok = await confirmDestructive(io, opts, `Create a new Neon project named "${name}"?`)
      if (!ok) {
        io.stdout(io.colors.hint('aborted.'))
        return
      }
      const result = await adapters.db().createProject({ name, region: opts.region })
      emit(
        io,
        opts.json,
        result,
        (p) =>
          `${io.colors.success('✓')} created project: ${io.colors.resource(p.name)} ${io.colors.hint(`(${p.id})`)}`,
      )
    })

  project
    .command('list')
    .description('List database projects')
    .option('--json', 'Emit raw JSON', false)
    .action(async (opts: { json: boolean }) => {
      const projects = await adapters.db().listProjects()
      emit(io, opts.json, projects, (list) =>
        table(
          list.map((p) => ({ id: p.id, name: p.name })),
          io.colors,
        ),
      )
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
        io.colors.warn(
          'note: this is an escape-hatch command. The Rando Neon project should be torn down via the Neon dashboard, not the CLI.',
        ),
      )
      const ok = await confirmDestructive(
        io,
        opts,
        `Delete db project ${io.colors.resource(`"${projectId}"`)} and all of its data?`,
      )
      if (!ok) {
        io.stdout(io.colors.hint('aborted.'))
        return
      }
      await adapters.db().deleteProject({ projectId })
      emit(
        io,
        opts.json,
        { ok: true, projectId },
        () => `${io.colors.success('✓')} deleted project: ${io.colors.resource(projectId)}`,
      )
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
      emit(
        io,
        opts.json,
        b,
        (br) =>
          `${io.colors.success('✓')} created branch: ${io.colors.resource(br.name)} ${io.colors.hint(`(${br.id})`)}`,
      )
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
          io.colors,
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
        `Delete db branch ${io.colors.resource(`"${branchId}"`)} on project ${io.colors.resource(`"${projectId}"`)}?`,
      )
      if (!ok) {
        io.stdout(io.colors.hint('aborted.'))
        return
      }
      await adapters.db().deleteBranch({ projectId, branchId })
      emit(
        io,
        opts.json,
        { ok: true, branchId },
        () => `${io.colors.success('✓')} deleted branch: ${io.colors.resource(branchId)}`,
      )
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

  db.command('sync')
    .description(
      'Reset one Neon branch to match another (e.g. main → staging, staging → dev-<name>). Destructive — the destination branch is overwritten in place.',
    )
    .requiredOption('--from <branch>', 'Source branch name')
    .requiredOption('--to <branch>', 'Destination branch name (will be overwritten)')
    .option(
      '--config <path>',
      'Path to rando.config.json (default: repo root)',
      DEFAULT_CONFIG_PATH,
    )
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (opts: { from: string; to: string; config: string; yes: boolean; json: boolean }) => {
        if (opts.from === opts.to) {
          throw new Error('--from and --to must be different branches')
        }
        const configPath = resolve(process.cwd(), opts.config)
        const config = loadSetupConfig(configPath)
        const provider = adapters.db()

        const projects = await provider.listProjects()
        const project = projects.find((p) => p.name === config.project)
        if (!project) {
          throw new NotFoundError('Neon project (from rando.config.json)', config.project)
        }
        const branches = await provider.listBranches({ projectId: project.id })
        const source = branches.find((b) => b.name === opts.from)
        const dest = branches.find((b) => b.name === opts.to)
        if (!source) throw new NotFoundError('source branch', opts.from)
        if (!dest) throw new NotFoundError('destination branch', opts.to)

        // Loud warning on the production branch — overwriting `main` is the
        // worst-case destructive op in this command.
        if (dest.name === 'main') {
          io.stderr(
            io.colors.warn(
              'WARNING: --to=main overwrites production data. Neon keeps an automatic snapshot of the previous state, but you should be very sure.',
            ),
          )
        }

        const ok = await confirmDestructive(
          io,
          opts,
          `Reset db branch ${io.colors.resource(`"${opts.to}"`)} to match ${io.colors.resource(`"${opts.from}"`)}?`,
        )
        if (!ok) {
          io.stdout(io.colors.hint('aborted.'))
          return
        }

        const sp = io.spinner(
          `Resetting ${io.colors.resource(opts.to)} → ${io.colors.resource(opts.from)}…`,
        )
        try {
          await provider.resetBranch({
            projectId: project.id,
            branchId: dest.id,
            sourceBranchId: source.id,
          })
          sp.succeed(`${io.colors.resource(opts.to)} now matches ${io.colors.resource(opts.from)}`)
        } catch (e) {
          sp.fail(`sync failed`)
          throw e
        }

        emit(
          io,
          opts.json,
          { ok: true, from: opts.from, to: opts.to },
          () =>
            `${io.colors.success('✓')} sync complete: ${io.colors.resource(opts.from)} → ${io.colors.resource(opts.to)}`,
        )
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
          () =>
            `${io.colors.success('✓')} enabled extension ${io.colors.resource(`"${extension}"`)} on ${io.colors.resource(branchId)}`,
        )
      },
    )

  return db
}
