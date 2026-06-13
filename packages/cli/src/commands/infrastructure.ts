import { Command } from 'commander'
import { resolve } from 'node:path'
import type { Adapters } from '../config'
import type { Io, IoSpinner } from '../output'
import {
  ProductionDestroyForbiddenError,
  runDestroy,
  runSetup,
  type SetupEvent,
} from '../orchestrate'
import { ALL_ENVS, loadSetupConfig, type SetupEnv } from '../setup-config'
import { formatDuration, startTimer } from '../timing'
import { confirmDestructive } from './_confirm'

const DEFAULT_CONFIG_PATH = 'rando.config.json'
const DESTROYABLE_ENVS: SetupEnv[] = ['dev', 'staging']

export function infrastructureCommand(adapters: Adapters, io: Io): Command {
  const infra = new Command('infrastructure')
    .description('End-to-end infrastructure orchestration')
    .alias('infra')

  infra
    .command('setup')
    .description('Provision DB, tunnel, deploys, and DNS from rando.config.json')
    .option('--env <envs>', `Comma-separated subset of: ${ALL_ENVS.join('|')}`, ALL_ENVS.join(','))
    .option('--apps <names>', 'Comma-separated app names (default: all apps in config)', '')
    .option(
      '--config <path>',
      'Path to rando.config.json (default: repo root)',
      DEFAULT_CONFIG_PATH,
    )
    .option('--dry-run', 'Print what would happen without calling any APIs', false)
    .action(async (opts: { env: string; apps: string; config: string; dryRun: boolean }) => {
      const envs = parseEnvs(opts.env)
      const apps = opts.apps ? opts.apps.split(',').map((s) => s.trim()) : []
      const configPath = resolve(process.cwd(), opts.config)
      const config = loadSetupConfig(configPath)

      printPlan(io, {
        configPath,
        project: config.project,
        envs: envs.join(', '),
        apps: apps.length ? apps.join(', ') : config.apps.map((a) => a.name).join(', '),
      })

      if (opts.dryRun) {
        io.stdout(io.colors.hint('--dry-run: stopping before any API calls'))
        return
      }

      const emit = makeEventRenderer(io)
      const elapsed = startTimer()
      await runSetup(
        {
          db: adapters.db(),
          tunnel: adapters.tunnel(),
          deploy: adapters.deploy(),
          dns: adapters.dns(),
        },
        { config, envs, apps, emit },
      )
      io.stdout('')
      io.stdout(
        `${io.colors.success('infrastructure setup complete.')} ${io.colors.hint(`(${formatDuration(elapsed())})`)}`,
      )
    })

  infra
    .command('destroy')
    .description('Tear down infrastructure for one env. Production is refused.')
    .requiredOption('--env <env>', `Single env to destroy: ${DESTROYABLE_ENVS.join(' | ')}`)
    .option('--apps <names>', 'Comma-separated app names (default: all apps in config)', '')
    .option(
      '--config <path>',
      'Path to rando.config.json (default: repo root)',
      DEFAULT_CONFIG_PATH,
    )
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--dry-run', 'Print what would happen without calling any APIs', false)
    .action(
      async (opts: {
        env: string
        apps: string
        config: string
        yes: boolean
        dryRun: boolean
      }) => {
        const env = parseSingleEnv(opts.env)
        if (env === 'production') throw new ProductionDestroyForbiddenError()

        const apps = opts.apps ? opts.apps.split(',').map((s) => s.trim()) : []
        const configPath = resolve(process.cwd(), opts.config)
        const config = loadSetupConfig(configPath)

        const appNames = apps.length ? apps : config.apps.map((a) => a.name)
        printPlan(io, {
          configPath,
          project: config.project,
          envs: env,
          apps: appNames.join(', '),
        })

        if (opts.dryRun) {
          io.stdout(io.colors.hint('--dry-run: stopping before any API calls'))
          return
        }

        const ok = await confirmDestructive(
          io,
          { yes: opts.yes },
          `Destroy ${io.colors.warn(env)} infrastructure for ${io.colors.resource(config.project)} (apps: ${appNames.join(', ')})?`,
        )
        if (!ok) {
          io.stdout(io.colors.hint('aborted.'))
          return
        }

        const emit = makeEventRenderer(io)
        const elapsed = startTimer()
        await runDestroy(
          {
            db: adapters.db(),
            tunnel: adapters.tunnel(),
            deploy: adapters.deploy(),
            dns: adapters.dns(),
          },
          { config, env, apps, emit },
        )
        io.stdout('')
        io.stdout(
          `${io.colors.success('infrastructure destroy complete.')} ${io.colors.hint(`(${formatDuration(elapsed())})`)}`,
        )
      },
    )

  return infra
}

function parseSingleEnv(raw: string): SetupEnv {
  const trimmed = raw.trim() as SetupEnv
  if (!ALL_ENVS.includes(trimmed)) {
    throw new Error(`Invalid env "${trimmed}". Must be one of: ${ALL_ENVS.join(', ')}`)
  }
  return trimmed
}

function parseEnvs(raw: string): SetupEnv[] {
  return raw.split(',').map((s) => {
    const t = s.trim() as SetupEnv
    if (!ALL_ENVS.includes(t)) {
      throw new Error(`Invalid env "${t}". Must be one (or more) of: ${ALL_ENVS.join(', ')}`)
    }
    return t
  })
}

function printPlan(
  io: Io,
  plan: { configPath: string; project: string; envs: string; apps: string },
): void {
  io.stdout(`${io.colors.hint('config:')}  ${plan.configPath}`)
  io.stdout(`${io.colors.hint('project:')} ${io.colors.resource(plan.project)}`)
  io.stdout(`${io.colors.hint('envs:')}    ${plan.envs}`)
  io.stdout(`${io.colors.hint('apps:')}    ${plan.apps}`)
  io.stdout('')
}

/**
 * Translate an orchestrator event stream into live spinner state. The
 * orchestrator emits step-start → (async work) → step-done|step-skip|note,
 * which maps cleanly onto the spinner lifecycle:
 *  - step-start  opens a spinner
 *  - step-done   resolves with ✓ (success color)
 *  - step-skip   resolves with ℹ (warn color) — "already exists" outcomes
 *  - note        prints a dim auxiliary line under the current spinner
 *
 * A step-done|skip with no preceding step-start prints a plain line —
 * some phases (vercel domain add inside the per-app loop) emit done
 * events directly without a paired step-start. Spinners stay clean
 * either way.
 */
export function makeEventRenderer(io: Io): (event: SetupEvent) => void {
  let active: IoSpinner | null = null
  const resolve = (kind: 'succeed' | 'info', text: string) => {
    if (active) {
      active[kind](text)
      active = null
    } else {
      const symbol = kind === 'succeed' ? io.colors.success('✓') : io.colors.warn('↺')
      io.stdout(`${symbol} ${text}`)
    }
  }
  return (event: SetupEvent) => {
    switch (event.kind) {
      case 'step-start':
        if (active) active.stop()
        active = io.spinner(event.message)
        return
      case 'step-done':
        resolve('succeed', event.message)
        return
      case 'step-skip':
        resolve('info', event.message)
        return
      case 'note':
        if (active) {
          active.stop()
          active = null
        }
        io.stdout(`  ${io.colors.hint(event.message)}`)
        return
      default:
        return event satisfies never
    }
  }
}
