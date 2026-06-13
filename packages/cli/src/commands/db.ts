import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { Command } from 'commander'
import type { Adapters } from '../config'
import type { DbProvider } from '../domain/db'
import { NotFoundError } from '../domain/errors'
import { emit, table, type Io, type SelectChoice } from '../output'
import { loadSetupConfig } from '../setup-config'
import { confirmDestructive } from './_confirm'
import { askOr, pickOr } from './_interactive'

const DEFAULT_CONFIG_PATH = 'rando.config.json'

export function dbCommand(adapters: Adapters, io: Io): Command {
  const db = new Command('db').description('Database (Postgres) operations')

  // Loaders that turn provider list results into select choices. Each runs
  // lazily — only fires if the relevant positional was missing.
  const projectChoices = async (): Promise<SelectChoice<string>[]> => {
    const projects = await adapters.db().listProjects()
    return projects.map((p) => ({ name: `${p.name}`, value: p.id, description: p.id }))
  }
  const branchChoices = async (projectId: string): Promise<SelectChoice<string>[]> => {
    const branches = await adapters.db().listBranches({ projectId })
    return branches.map((b) => ({
      name: b.name,
      value: b.id,
      description: `${b.id} · created ${b.createdAt}`,
    }))
  }
  const branchNameChoices = async (projectId: string): Promise<SelectChoice<string>[]> => {
    const branches = await adapters.db().listBranches({ projectId })
    return branches.map((b) => ({ name: b.name, value: b.name, description: b.id }))
  }

  const project = new Command('project').description('Manage database projects')

  project
    .command('create [name]')
    .description('Create a new Neon project. Escape hatch — normally use `rando infra setup`.')
    .option('--region <region>', 'Region identifier (e.g. aws-us-east-2)')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        nameArg: string | undefined,
        opts: { region?: string; yes: boolean; json: boolean },
      ) => {
        io.stderr(
          io.colors.warn(
            'note: this is an escape-hatch command. For the Rando stack, `rando infra setup` creates the Neon project from rando.config.json.',
          ),
        )
        const name = await askOr(io, nameArg, 'New Neon project name:', 'name')
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
      },
    )

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
    .command('delete [projectId]')
    .description(
      'Delete a Neon project (all branches + data). Escape hatch — for the Rando project, prefer the Neon dashboard so you see exactly what you are nuking.',
    )
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(async (projectIdArg: string | undefined, opts: { yes: boolean; json: boolean }) => {
      io.stderr(
        io.colors.warn(
          'note: this is an escape-hatch command. The Rando Neon project should be torn down via the Neon dashboard, not the CLI.',
        ),
      )
      const projectId = await pickOr(
        io,
        projectIdArg,
        projectChoices,
        'Which Neon project should be deleted?',
        'projectId',
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
    .command('create [projectId] [name]')
    .description('Create a branch under a project')
    .option('--from <branchId>', 'Source branch id to fork from')
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        projectIdArg: string | undefined,
        nameArg: string | undefined,
        opts: { from?: string; json: boolean },
      ) => {
        const projectId = await pickOr(
          io,
          projectIdArg,
          projectChoices,
          'Project to create the branch in:',
          'projectId',
        )
        const name = await askOr(io, nameArg, 'New branch name:', 'name')
        const b = await adapters.db().createBranch({ projectId, name, fromBranchId: opts.from })
        emit(
          io,
          opts.json,
          b,
          (br) =>
            `${io.colors.success('✓')} created branch: ${io.colors.resource(br.name)} ${io.colors.hint(`(${br.id})`)}`,
        )
      },
    )

  branch
    .command('list [projectId]')
    .description('List branches in a project')
    .option('--json', 'Emit raw JSON', false)
    .action(async (projectIdArg: string | undefined, opts: { json: boolean }) => {
      const projectId = await pickOr(
        io,
        projectIdArg,
        projectChoices,
        'Project to list branches for:',
        'projectId',
      )
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
    .command('delete [projectId] [branchId]')
    .description('Delete a database branch. Irreversible.')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        projectIdArg: string | undefined,
        branchIdArg: string | undefined,
        opts: { yes: boolean; json: boolean },
      ) => {
        const projectId = await pickOr(
          io,
          projectIdArg,
          projectChoices,
          'Which project?',
          'projectId',
        )
        const branchId = await pickOr(
          io,
          branchIdArg,
          () => branchChoices(projectId),
          'Which branch to delete?',
          'branchId',
        )
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
      },
    )

  db.addCommand(branch)

  db.command('connection-string [projectId] [branchId]')
    .description('Print a connection string for a branch')
    .option('--pooled', 'Return the pooled connection string', false)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        projectIdArg: string | undefined,
        branchIdArg: string | undefined,
        opts: { pooled: boolean; json: boolean },
      ) => {
        const projectId = await pickOr(
          io,
          projectIdArg,
          projectChoices,
          'Which project?',
          'projectId',
        )
        const branchId = await pickOr(
          io,
          branchIdArg,
          () => branchChoices(projectId),
          'Which branch?',
          'branchId',
        )
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
    .option('--from <branch>', 'Source branch name')
    .option('--to <branch>', 'Destination branch name (will be overwritten)')
    .option(
      '--config <path>',
      'Path to rando.config.json (default: repo root)',
      DEFAULT_CONFIG_PATH,
    )
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (opts: { from?: string; to?: string; config: string; yes: boolean; json: boolean }) => {
        // Early validation when both flags are explicitly given — avoids
        // hitting the API for a request we know to reject.
        if (opts.from && opts.to && opts.from === opts.to) {
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

        const from = await pickOr(
          io,
          opts.from,
          () => branchNameChoices(project.id),
          'Source branch (read from):',
          'from',
        )
        const to = await pickOr(
          io,
          opts.to,
          async () => {
            const choices = await branchNameChoices(project.id)
            return choices.filter((c) => c.value !== from)
          },
          'Destination branch (overwrite):',
          'to',
        )
        if (from === to) throw new Error('--from and --to must be different branches')

        const branches = await provider.listBranches({ projectId: project.id })
        const source = branches.find((b) => b.name === from)
        const dest = branches.find((b) => b.name === to)
        if (!source) throw new NotFoundError('source branch', from)
        if (!dest) throw new NotFoundError('destination branch', to)

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
          `Reset db branch ${io.colors.resource(`"${to}"`)} to match ${io.colors.resource(`"${from}"`)}?`,
        )
        if (!ok) {
          io.stdout(io.colors.hint('aborted.'))
          return
        }

        const sp = io.spinner(`Resetting ${io.colors.resource(to)} → ${io.colors.resource(from)}…`)
        try {
          await provider.resetBranch({
            projectId: project.id,
            branchId: dest.id,
            sourceBranchId: source.id,
          })
          sp.succeed(`${io.colors.resource(to)} now matches ${io.colors.resource(from)}`)
        } catch (e) {
          sp.fail(`sync failed`)
          throw e
        }

        emit(
          io,
          opts.json,
          { ok: true, from, to },
          () =>
            `${io.colors.success('✓')} sync complete: ${io.colors.resource(from)} → ${io.colors.resource(to)}`,
        )
      },
    )

  db.command('copy')
    .description(
      "Copy a Postgres database from one connection string to another via pg_dump | pg_restore. Use for cross-Neon-project syncs that `db sync` (which is in-project only) can't handle. Requires `pg_dump`/`pg_restore` on PATH (Postgres 16+ for Neon).",
    )
    .requiredOption('--from-conn <url>', 'Source Postgres connection string')
    .requiredOption('--to-conn <url>', 'Destination Postgres connection string (will be reset)')
    .option('--schema-only', 'Copy schema without data', false)
    .option('--no-clean', 'Skip the pg_restore --clean step (do not drop existing objects)')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .action(
      async (opts: {
        fromConn: string
        toConn: string
        schemaOnly: boolean
        clean: boolean
        yes: boolean
      }) => {
        if (opts.fromConn === opts.toConn) {
          throw new Error('--from-conn and --to-conn must be different connection strings')
        }
        // We never want to print these to the log — they contain credentials.
        const ok = await confirmDestructive(
          io,
          opts,
          `Copy database (${opts.schemaOnly ? 'schema only' : 'schema + data'}) into the destination? The destination will be overwritten.`,
        )
        if (!ok) {
          io.stdout(io.colors.hint('aborted.'))
          return
        }

        const sp = io.spinner('Running pg_dump | pg_restore…')
        try {
          await pipePgDump({
            from: opts.fromConn,
            to: opts.toConn,
            schemaOnly: opts.schemaOnly,
            clean: opts.clean !== false,
            io,
          })
          sp.succeed('db copy complete')
        } catch (e) {
          sp.fail(`db copy failed: ${(e as Error).message ?? e}`)
          throw e
        }
      },
    )

  db.command('extension-enable [projectId] [branchId] [extension]')
    .description('Enable a Postgres extension on a branch (e.g. postgis)')
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        projectIdArg: string | undefined,
        branchIdArg: string | undefined,
        extensionArg: string | undefined,
        opts: { json: boolean },
      ) => {
        const projectId = await pickOr(
          io,
          projectIdArg,
          projectChoices,
          'Which project?',
          'projectId',
        )
        const branchId = await pickOr(
          io,
          branchIdArg,
          () => branchChoices(projectId),
          'Which branch?',
          'branchId',
        )
        const extension = await askOr(
          io,
          extensionArg,
          'Extension name (e.g. postgis):',
          'extension',
        )
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

/**
 * Pipe `pg_dump <from>` directly into `pg_restore <to>`. Streams data
 * without buffering — works for arbitrarily large databases. stderr from
 * both processes is forwarded to the Io so the user can see progress and
 * diagnostics.
 *
 * Resolves on success (both processes exit 0). Rejects with the first
 * non-zero exit encountered.
 */
async function pipePgDump(input: {
  from: string
  to: string
  schemaOnly: boolean
  clean: boolean
  io: Io
}): Promise<void> {
  const { io } = input
  const dumpArgs = [
    '--no-owner',
    '--no-acl',
    '-Fc',
    ...(input.schemaOnly ? ['--schema-only'] : []),
    input.from,
  ]
  const restoreArgs = [
    '--no-owner',
    '--no-acl',
    ...(input.clean ? ['--clean', '--if-exists'] : []),
    '-d',
    input.to,
  ]

  const dump = spawn('pg_dump', dumpArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
  const restore = spawn('pg_restore', restoreArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
  dump.stdout.pipe(restore.stdin)

  // Forward stderr from both to the Io as dimmed hint lines so the
  // active spinner above stays uncluttered but diagnostics still flow.
  const forward = (label: string) => (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) io.stderr(io.colors.hint(`[${label}] ${line}`))
    }
  }
  dump.stderr.on('data', forward('pg_dump'))
  restore.stderr.on('data', forward('pg_restore'))

  const dumpExit = new Promise<number>((res) => dump.on('exit', (c) => res(c ?? 1)))
  const restoreExit = new Promise<number>((res) => restore.on('exit', (c) => res(c ?? 1)))
  const [dc, rc] = await Promise.all([dumpExit, restoreExit])
  if (dc !== 0) throw new Error(`pg_dump exited with code ${dc}`)
  if (rc !== 0) throw new Error(`pg_restore exited with code ${rc}`)
}

// Re-export for tests that want to introspect the provider type used above
export type { DbProvider }
