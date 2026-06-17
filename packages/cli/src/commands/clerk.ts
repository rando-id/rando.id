// `rando clerk` — wraps the official `clerk` CLI's authenticated
// Backend API so the parts of Clerk setup that can be scripted aren't
// stuck in their dashboard.
//
// Subcommands:
//   - whoami --env <env>          Verify the secret key in 1P works.
//   - webhook setup --env <env>   Half-auto: ensure Svix app, fetch
//                                 dashboard URL, prompt for signing
//                                 secret, push to 1P + Vercel.
//   - users create --env <env>    Create a user (for seeding staging).
//
// The secret key is always read from 1P at command time, scoped to
// the chosen env — so the dev/staging instance never gets mixed up
// with production. We never ask the user to paste it manually.

import { resolve } from 'node:path'
import { Command } from 'commander'
import { ClerkCliAdapter } from '../adapters/clerk-cli'
import type { Adapters } from '../config'
import type { ClerkProvider } from '../domain/clerk'
import { ProviderApiError } from '../domain/errors'
import { type Io } from '../output'
import { ALL_SECRETS_ENVS, loadSetupConfig, type SecretsEnv } from '../setup-config'
import { vercelProjectName } from '../setup-config'

const DEFAULT_CONFIG_PATH = 'rando.config.json'

export interface ClerkCommandOptions {
  /**
   * Override how a ClerkProvider is built from a secret key. Used by
   * tests to swap in a stub adapter. Default constructs ClerkCliAdapter.
   */
  clerkFactory?: (secretKey: string) => ClerkProvider
}

export function clerkCommand(
  adapters: Adapters,
  io: Io,
  options: ClerkCommandOptions = {},
): Command {
  const clerkFactory =
    options.clerkFactory ?? ((secretKey: string) => new ClerkCliAdapter({ secretKey }))

  const clerk = new Command('clerk').description(
    'Wraps the Clerk CLI to script setup steps that would otherwise need the dashboard.',
  )

  clerk
    .command('whoami')
    .description("Check the env's CLERK_SECRET_KEY by hitting GET /users/count.")
    .option('--env <env>', 'Which 1P environment to source the secret from.', 'local')
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .action(async (opts: { env: string; config: string }) => {
      const { colors } = io
      const { env, secretKey } = await resolveSecretKey(adapters, opts.env, opts.config)
      const provider = clerkFactory(secretKey)
      const { count } = await provider.whoami()
      io.stdout(
        `${colors.success('✓')} clerk ${colors.resource(env)} reachable — ${colors.bold(String(count))} user(s) in this instance`,
      )
    })

  const webhook = new Command('webhook').description('Manage Clerk webhook endpoints.')
  webhook
    .command('setup')
    .description(
      "Ensure a Svix app exists, open the Clerk-issued Svix dashboard URL, prompt for the new endpoint's signing secret, then write CLERK_WEBHOOK_SECRET to 1P and push to the api Vercel project.",
    )
    .requiredOption('--env <env>', `Target 1P env: ${ALL_SECRETS_ENVS.join(' | ')}.`)
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--app <name>', 'App name to push the secret to on Vercel.', 'api')
    .action(async (opts: { env: string; config: string; app: string }) => {
      const { colors } = io
      const { env, secretKey, cfg, secretsConfig } = await resolveSecretKey(
        adapters,
        opts.env,
        opts.config,
      )
      const provider = clerkFactory(secretKey)

      const svix = await provider.ensureSvixApp()
      io.stdout(
        svix.alreadyExists
          ? `${colors.hint('↺')} Svix app already exists for this Clerk instance`
          : `${colors.success('✓')} Svix app created`,
      )

      const { url } = await provider.getSvixDashboardUrl()
      io.stdout('')
      io.stdout(`${colors.hint('Open this Svix dashboard URL in your browser:')}`)
      io.stdout(`  ${colors.resource(url)}`)
      io.stdout('')
      io.stdout(`${colors.hint('Then:')}`)
      io.stdout(`  1. Click "Add Endpoint"`)
      io.stdout(
        `  2. Endpoint URL: ${colors.bold(webhookEndpointFor(env, cfg.domains.nonProd, cfg.domains.production))}`,
      )
      io.stdout(`  3. Subscribe to: user.created, user.updated, user.deleted`)
      io.stdout(`  4. Copy the signing secret (starts with whsec_)`)
      io.stdout('')

      const signingSecret = (await io.input('Paste the signing secret:')).trim()
      if (!signingSecret.startsWith('whsec_')) {
        throw new Error(
          `Expected a signing secret starting with whsec_, got "${signingSecret.slice(0, 12)}..." — refusing to write.`,
        )
      }

      // Store in 1P first (idempotent / upsert), then push to Vercel.
      const opProvider = adapters.secrets()
      const envId = secretsConfig.environments[env]!
      await opProvider.write({
        vault: envId,
        item: 'CLERK_WEBHOOK_SECRET',
        field: secretsConfig.field,
        value: signingSecret,
      })
      io.stdout(`${colors.success('✓')} CLERK_WEBHOOK_SECRET written to 1P ${env}`)

      // Push to Vercel project. Only staging/prod have a Vercel side —
      // local maps to the operator's apps/api/.env via `rando secrets sync`.
      if (env === 'local') {
        io.stdout(
          `${colors.hint('local env — run `pnpm rando secrets sync` to pull the new value into apps/api/.env')}`,
        )
      } else {
        const deploy = adapters.deploy()
        const projectName = vercelProjectName(cfg, requireApp(cfg, opts.app))
        const project = await deploy.getProjectByName({ name: projectName })
        if (!project) {
          throw new ProviderApiError(
            'orchestrator',
            404,
            `vercel project "${projectName}" not found`,
            `Run \`rando infrastructure setup --env ${env} --apps ${opts.app}\` first.`,
          )
        }
        const scope = env === 'staging' ? 'preview' : 'production'
        await deploy.setEnv({
          projectId: project.id,
          key: 'CLERK_WEBHOOK_SECRET',
          value: signingSecret,
          scopes: [scope],
        })
        io.stdout(
          `${colors.success('✓')} CLERK_WEBHOOK_SECRET pushed to ${colors.resource(projectName)} \`${scope}\` scope`,
        )
      }
    })
  clerk.addCommand(webhook)

  const users = new Command('users').description('Manage Clerk users.')
  users
    .command('create')
    .description(
      'Create a Clerk user via Backend API. Good for seeding staging without the dashboard.',
    )
    .requiredOption('--env <env>', `Target 1P env: ${ALL_SECRETS_ENVS.join(' | ')}.`)
    .requiredOption('--email <email>', 'Primary email address.')
    .requiredOption('--password <password>', 'Initial password.')
    .option('--first-name <name>', 'First name.')
    .option('--last-name <name>', 'Last name.')
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .action(
      async (opts: {
        env: string
        config: string
        email: string
        password: string
        firstName?: string
        lastName?: string
      }) => {
        const { colors } = io
        const { secretKey } = await resolveSecretKey(adapters, opts.env, opts.config)
        const provider = clerkFactory(secretKey)
        const user = await provider.createUser({
          email: opts.email,
          password: opts.password,
          firstName: opts.firstName,
          lastName: opts.lastName,
        })
        io.stdout(
          `${colors.success('✓')} created clerk user ${colors.bold(user.email)} ${colors.hint(`(${user.id})`)}`,
        )
      },
    )
  clerk.addCommand(users)

  return clerk
}

// --- internals --------------------------------------------------------

/**
 * Resolve the CLERK_SECRET_KEY for a given env by reading the 1P
 * environment via the SecretsProvider. We use the same provider the
 * rest of the CLI uses, so auth + account selection is consistent.
 */
async function resolveSecretKey(
  adapters: Adapters,
  rawEnv: string,
  configPath: string,
): Promise<{
  env: SecretsEnv
  secretKey: string
  cfg: ReturnType<typeof loadSetupConfig>
  secretsConfig: NonNullable<ReturnType<typeof loadSetupConfig>['secrets']>
}> {
  const env = parseSecretsEnv(rawEnv)
  const cfg = loadSetupConfig(resolve(process.cwd(), configPath))
  const secretsConfig = cfg.secrets
  if (!secretsConfig) {
    throw new Error(
      `No \`secrets\` block in ${configPath} — Clerk commands need one to fetch CLERK_SECRET_KEY from 1P.`,
    )
  }
  const envId = secretsConfig.environments[env]
  if (!envId) {
    throw new Error(
      `No 1P environment configured for "${env}". Add secrets.environments.${env} to rando.config.json.`,
    )
  }
  const provider = adapters.secrets()
  const values = await provider.readEnvironment(envId)
  const secretKey = (values['CLERK_SECRET_KEY'] ?? '').trim()
  if (!secretKey) {
    throw new Error(
      `CLERK_SECRET_KEY is empty in 1P environment ${env} (${envId}). Run \`rando secrets set CLERK_SECRET_KEY --env ${env}\` first.`,
    )
  }
  return { env, secretKey, cfg, secretsConfig }
}

function parseSecretsEnv(value: string): SecretsEnv {
  if ((ALL_SECRETS_ENVS as string[]).includes(value)) return value as SecretsEnv
  throw new Error(`Invalid --env "${value}". Expected one of: ${ALL_SECRETS_ENVS.join(', ')}.`)
}

/** Webhook endpoint URL for an env, derived from rando.config domains. */
function webhookEndpointFor(env: SecretsEnv, nonProd: string, prod: string): string {
  if (env === 'prod') return `https://api.${prod}/v1/webhooks/clerk`
  if (env === 'staging') return `https://staging-api.${nonProd}/v1/webhooks/clerk`
  return `https://dev-api.${nonProd}/v1/webhooks/clerk`
}

function requireApp(
  cfg: ReturnType<typeof loadSetupConfig>,
  name: string,
): ReturnType<typeof loadSetupConfig>['apps'][number] {
  const app = cfg.apps.find((a) => a.name === name)
  if (!app) {
    throw new Error(
      `App "${name}" not found in rando.config.json apps[]. Configured: ${cfg.apps.map((a) => a.name).join(', ')}.`,
    )
  }
  return app
}
