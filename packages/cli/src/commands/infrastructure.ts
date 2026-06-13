import { Command } from 'commander'
import { resolve } from 'node:path'
import type { Adapters } from '../config'
import type { Io } from '../output'
import {
  ProductionDestroyForbiddenError,
  runDestroy,
  runSetup,
  type SetupEvent,
} from '../orchestrate'
import { ALL_ENVS, loadSetupConfig, type SetupEnv } from '../setup-config'
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

      io.stdout(`config: ${configPath}`)
      io.stdout(`project: ${config.project}`)
      io.stdout(`envs:    ${envs.join(', ')}`)
      io.stdout(
        `apps:    ${apps.length ? apps.join(', ') : config.apps.map((a) => a.name).join(', ')}`,
      )
      io.stdout('')

      if (opts.dryRun) {
        io.stdout('--dry-run: stopping before any API calls')
        return
      }

      const emit = (event: SetupEvent) => io.stdout(formatEvent(event))
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
      io.stdout('infrastructure setup complete.')
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
        io.stdout(`config: ${configPath}`)
        io.stdout(`project: ${config.project}`)
        io.stdout(`env:     ${env}`)
        io.stdout(`apps:    ${appNames.join(', ')}`)
        io.stdout('')

        if (opts.dryRun) {
          io.stdout('--dry-run: stopping before any API calls')
          return
        }

        const ok = await confirmDestructive(
          io,
          { yes: opts.yes },
          `Destroy ${env} infrastructure for "${config.project}" (apps: ${appNames.join(', ')})?`,
        )
        if (!ok) {
          io.stdout('aborted.')
          return
        }

        const emit = (event: SetupEvent) => io.stdout(formatEvent(event))
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
        io.stdout('infrastructure destroy complete.')
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

function formatEvent(event: SetupEvent): string {
  if (event.kind === 'step-start') return `… ${event.message}`
  if (event.kind === 'step-done') return `✓ ${event.message}`
  if (event.kind === 'step-skip') return `↺ ${event.message}`
  if (event.kind === 'note') return `  ${event.message}`
  return event satisfies never
}
