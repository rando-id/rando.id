// `rando secrets` — bridge between 1Password (source of truth) and the
// local .env file (working cache). One vault per environment so
// dev/staging/prod credentials can't cross-contaminate.
//
// Subcommands:
//   - sync           Pull every configured var from the local vault
//                    into .env. --env staging|prod reads from a
//                    different vault when you need to debug elsewhere.
//   - set <VAR>      Store a value in one or more environments at once.
//                    Prompts for the value (masked) and env(s) when
//                    flags are missing. Replaces the old `save`.
//
// Convention (declared in rando.config.json's `secrets` block):
//   - account UUID passed as --account on every op call
//   - item title === env var name
//   - field name from `secrets.field` (default "credential")

import { resolve } from 'node:path'
import { Command } from 'commander'
import type { Adapters } from '../config'
import { type Io } from '../output'
import { ALL_SECRETS_ENVS, loadSetupConfig, type SecretsEnv } from '../setup-config'
import { TOKENS } from '../doctor/checks/env'
import { getEnvValue, readEnv, setEnvValue, writeEnv } from '../init/env-file'

const DEFAULT_CONFIG_PATH = 'rando.config.json'

interface SecretsConfig {
  field: string
  environments: Record<SecretsEnv, string | undefined>
}

export function secretsCommand(adapters: Adapters, io: Io): Command {
  const secrets = new Command('secrets').description(
    '1Password integration — pull configured env vars from a vault into .env, or set values across environments.',
  )

  secrets
    .command('sync')
    .description(
      'Pull every configured env var from the chosen environment vault into the local .env. Skips vars already set unless --force.',
    )
    .option('--env-file <path>', 'Path to .env (default: repo root)', '.env')
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option(
      '--env <env>',
      'Which vault to read from: local|staging|prod. Defaults to local.',
      'local',
    )
    .option(
      '-f, --force',
      'Re-fetch every var from 1P, overwriting any existing .env values.',
      false,
    )
    .action(async (opts: { envFile: string; config: string; env: string; force: boolean }) => {
      const { colors } = io
      const cfg = loadSecretsConfig(opts.config)
      const env = parseEnv(opts.env)
      const vault = requireVault(cfg, env)
      const provider = adapters.secrets()
      const identity = await provider.whoami()
      io.stdout(
        `${colors.hint('1Password:')} ${colors.resource(identity.account)} ${colors.hint(`(${identity.url})`)}`,
      )
      io.stdout(
        `${colors.hint('vault:')}     ${colors.resource(`${env} → ${vault}`)} ${colors.hint(`field=${cfg.field}`)}`,
      )
      io.stdout('')

      const envPath = resolve(process.cwd(), opts.envFile)
      const envFile = readEnv(envPath)
      let hits = 0
      let misses = 0
      let skipped = 0
      for (const spec of TOKENS) {
        const ref = `op://${vault}/${spec.name}/${cfg.field}`
        const hasExisting = (getEnvValue(envFile, spec.name) ?? '').trim().length > 0
        if (hasExisting && !opts.force) {
          skipped += 1
          io.stdout(
            `  ${colors.hint('skip:')}    ${spec.name} ${colors.hint('(already set in .env)')}`,
          )
          continue
        }
        try {
          const value = (await provider.read(ref)).trim()
          if (!value) {
            misses += 1
            io.stdout(`  ${colors.warn('empty:')}   ${spec.name} ${colors.hint(ref)}`)
            continue
          }
          setEnvValue(envFile, spec.name, value)
          hits += 1
          io.stdout(`  ${colors.success('fetch:')}   ${spec.name} ${colors.hint(ref)}`)
        } catch {
          misses += 1
          io.stdout(
            `  ${colors.hint('missing:')} ${spec.name} ${colors.hint(`(no item in ${env} vault)`)}`,
          )
        }
      }
      writeEnv(envPath, envFile)
      io.stdout('')
      io.stdout(
        `${colors.success('✓')} ${hits} fetched, ${skipped} skipped (already set), ${misses} missing in vault — wrote ${colors.resource(opts.envFile)}`,
      )
    })

  secrets
    .command('set <variable>')
    .description(
      'Set a secret value in one or more environment vaults at once. Prompts for the value (masked) and env(s) when not passed. Upserts — edits the item if it exists, creates if not.',
    )
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option(
      '--value <value>',
      'Non-interactive value. Prefer the prompt when possible — values passed via flags show up in shell history.',
    )
    .option(
      '--env <list>',
      'Comma-separated list of environments to write to (local,staging,prod). Mutually exclusive with --all.',
    )
    .option('--all', 'Write to every configured environment.', false)
    .action(
      async (
        variable: string,
        opts: { config: string; value?: string; env?: string; all: boolean },
      ) => {
        const { colors } = io
        const cfg = loadSecretsConfig(opts.config)
        const provider = adapters.secrets()
        const identity = await provider.whoami()

        // Resolve which environments to write to.
        const configuredEnvs = ALL_SECRETS_ENVS.filter((e) => cfg.environments[e])
        let targets: SecretsEnv[]
        if (opts.all) {
          targets = configuredEnvs
        } else if (opts.env) {
          targets = parseEnvList(opts.env)
          // Validate every env in the list has a vault configured.
          for (const env of targets) {
            if (!cfg.environments[env]) {
              throw new Error(
                `No environment configured for "${env}". Add it under secrets.environments in rando.config.json.`,
              )
            }
          }
        } else {
          // Interactive multi-select.
          const choice = await io.select<SecretsEnv | 'all'>('Which environment(s)?', [
            ...configuredEnvs.map((e) => ({
              name: e,
              value: e,
              description: cfg.environments[e] ?? '',
            })),
            { name: 'all configured envs', value: 'all' as const },
          ])
          targets = choice === 'all' ? configuredEnvs : [choice]
        }

        // Resolve the value.
        let value = opts.value
        if (!value) {
          value = await io.input(`Value for ${variable}:`)
        }
        if (!value) {
          throw new Error('Empty value — refusing to write.')
        }

        io.stdout(
          `${colors.hint('1Password:')} ${colors.resource(identity.account)} ${colors.hint('→ ' + targets.join(', '))}`,
        )
        for (const env of targets) {
          const vault = cfg.environments[env]!
          const ref = `op://${vault}/${variable}/${cfg.field}`
          await provider.write({
            vault,
            item: variable,
            field: cfg.field,
            value,
          })
          io.stdout(`  ${colors.success('✓')} ${env}: ${colors.hint(ref)}`)
        }
        io.stdout('')
        io.stdout(
          `${colors.success('✓')} ${variable} written to ${targets.length} vault(s). ` +
            `${colors.hint('Run `rando secrets sync` to pull into .env.')}`,
        )
      },
    )

  secrets
    .command('push <variable>')
    .description(
      'Read a secret from 1Password and write it to GitHub Actions repo secrets via `gh secret set`. Solves the OP_SERVICE_ACCOUNT_TOKEN bootstrap: the token that gives CI access to the rest of 1Password has to live somewhere CI can read it before any 1Password call works.',
    )
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option(
      '--from <env>',
      'Which configured vault to read from (local|staging|prod). Default: local.',
      'local',
    )
    .option(
      '--ref <op-ref>',
      "Explicit op:// reference (overrides --from). Use this when the secret lives in a vault that isn't in rando.config.json — for example, your Personal vault.",
    )
    .option(
      '--repo <owner/name>',
      'GitHub repo to push to (defaults to `repo` field in rando.config.json).',
    )
    .action(
      async (
        variable: string,
        opts: { config: string; from: string; ref?: string; repo?: string },
      ) => {
        const { colors } = io

        // Resolve the source reference. --ref wins; otherwise build
        // from --from + config convention.
        let ref: string
        if (opts.ref) {
          ref = opts.ref
        } else {
          const cfg = loadSecretsConfig(opts.config)
          const env = parseEnv(opts.from)
          const vault = requireVault(cfg, env)
          ref = `op://${vault}/${variable}/${cfg.field}`
        }

        // Resolve the destination repo. --repo wins; otherwise the
        // `repo` field in rando.config.json (the same one tracker uses).
        const repo = opts.repo ?? loadSetupConfig(resolve(process.cwd(), opts.config)).repo

        const secretsProvider = adapters.secrets()
        const ghProvider = adapters.gh()

        // Verify both sides up front so we fail fast instead of
        // resolving the secret then choking on auth.
        const opMe = await secretsProvider.whoami()
        const ghMe = await ghProvider.whoami()
        io.stdout(
          `${colors.hint('source:')} ${colors.resource(ref)} ${colors.hint(`(${opMe.account})`)}`,
        )
        io.stdout(
          `${colors.hint('target:')} ${colors.resource(`github://${repo}/secrets/${variable}`)} ${colors.hint(`(@${ghMe.login})`)}`,
        )

        const value = (await secretsProvider.read(ref)).trim()
        if (!value) {
          throw new Error(`Empty value at ${ref} — refusing to push.`)
        }
        await ghProvider.setRepoSecret({ repo, name: variable, value })
        io.stdout(
          `${colors.success('✓')} ${variable} set as a GitHub Actions repo secret on ${colors.resource(repo)}`,
        )
      },
    )

  return secrets
}

/**
 * Load + validate the `secrets` block from rando.config.json. Throws a
 * friendly error when missing so the user gets a hint about adding it,
 * not a cryptic property-access trace.
 */
function loadSecretsConfig(configPath: string): SecretsConfig {
  const cfg = loadSetupConfig(resolve(process.cwd(), configPath))
  if (!cfg.secrets) {
    throw new Error(
      `No \`secrets\` block in ${configPath}. Add { "secrets": { "kind": "1password", "account": "<uuid>", "field": "credential", "environments": { "local": "<environment-id>" } } } to enable.`,
    )
  }
  return {
    field: cfg.secrets.field,
    environments: {
      local: cfg.secrets.environments.local,
      staging: cfg.secrets.environments.staging,
      prod: cfg.secrets.environments.prod,
    },
  }
}

/** Parse a single env name from the CLI flag, validating against the known set. */
function parseEnv(value: string): SecretsEnv {
  if ((ALL_SECRETS_ENVS as string[]).includes(value)) return value as SecretsEnv
  throw new Error(`Invalid --env "${value}". Expected one of: ${ALL_SECRETS_ENVS.join(', ')}.`)
}

/** Parse a comma-separated list of env names from the CLI flag. */
function parseEnvList(value: string): SecretsEnv[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseEnv)
}

/** Look up an environment id for an env name, throwing if not configured. */
function requireVault(cfg: SecretsConfig, env: SecretsEnv): string {
  const vault = cfg.environments[env]
  if (!vault) {
    throw new Error(
      `No environment configured for "${env}". Add secrets.environments.${env} to rando.config.json.`,
    )
  }
  return vault
}
