// Loads + validates `rando.config.json` (the orchestration config used by
// `rando infrastructure setup`). Pure: no I/O at module load.

import { readFileSync } from 'node:fs'
import { z } from 'zod'

export const SetupConfigSchema = z.object({
  /** Used as the Neon project name and the prefix for Vercel project names. */
  project: z.string().min(1),

  /** GitHub repo in "owner/name" form — Vercel needs this to link projects. */
  repo: z.string().regex(/^[^/]+\/[^/]+$/, 'expected "owner/name"'),

  /** Cloudflare Tunnel name (created if absent). */
  tunnel: z.string().min(1).default('rando-dev'),

  /** Apex domains for each domain group. */
  domains: z.object({
    /** Non-prod traffic (local + staging share this zone). */
    nonProd: z.string().min(1),
    /** Production. */
    production: z.string().min(1),
  }),

  /** Apps in the monorepo that get Vercel projects + tunnel routes. */
  apps: z
    .array(
      z.object({
        /** Short app name used in subdomains (e.g. "api", "web", "admin"). */
        name: z.string().min(1),
        /** Repo-relative root directory (e.g. "apps/api"). */
        rootDirectory: z.string().min(1),
        /** Local dev-server port that the tunnel routes to. */
        port: z.number().int().positive(),
        /**
         * If true, this app lives at the apex of the production domain
         * (e.g. web → rando.id, not web.rando.id). Only one app should set
         * this. Staging always uses the `staging-<name>` subdomain pattern.
         */
        prodApex: z.boolean().default(false),
      }),
    )
    .min(1),

  /**
   * Issue-tracker integration. Optional — when absent, `rando issues`
   * commands and the commit hook still work but they can't auto-
   * transition tickets through the Rando lifecycle (PR open → In
   * Progress, branch deploy → In Review, merge → Done).
   *
   * `tracker.kind` picks the adapter; the matching sub-block carries
   * the adapter-specific config. Run `rando issues doctor` after
   * filling this in to verify the wiring.
   */
  tracker: z
    .object({
      kind: z.enum(['github', 'jira']).default('github'),
      /**
       * Branches where the picker always prompts, ignoring any cached
       * key. Feature-branch caching makes sense (one ticket per
       * branch's lifetime); trunk branches don't — every commit on
       * `main` is typically a different concern. The picker treats
       * these as "always reset" so a stale cache from weeks ago
       * doesn't silently get re-applied.
       */
      protectedBranches: z.array(z.string().min(1)).default(['main', 'master']),
      /** Required when kind is "github". Defaults give sensible label names. */
      github: z
        .object({
          /**
           * Lifecycle slot → label name. The adapter adds the slot's
           * label and removes the others (and any other label starting
           * with `status:`) when applyLifecycle fires.
           */
          labels: z
            .object({
              inProgress: z.string().min(1).default('status:in-progress'),
              inReview: z.string().min(1).default('status:in-review'),
            })
            .default({
              inProgress: 'status:in-progress',
              inReview: 'status:in-review',
            }),
        })
        .default({
          labels: {
            inProgress: 'status:in-progress',
            inReview: 'status:in-review',
          },
        }),
      /** Required when kind is "jira". */
      jira: z
        .object({
          projectKey: z.string().min(1),
          /**
           * Map from semantic lifecycle state → Jira transition name OR
           * id. Either works; the doctor command shows both.
           */
          transitions: z
            .object({
              inProgress: z.string().min(1).optional(),
              inReview: z.string().min(1).optional(),
              done: z.string().min(1).optional(),
            })
            .partial()
            .default({}),
        })
        .optional(),
    })
    .optional(),

  /**
   * Database provisioning + behavior. Only meaningful for the
   * `rando infrastructure setup` orchestrator; everyday CLI commands
   * (`rando db ...`) talk to Neon directly and ignore this block.
   *
   * `managedBy: 'vercel'` switches the project-creation step from
   * direct Neon-API calls to `vercel install neon`, because
   * Vercel-managed Neon orgs reject direct creates with
   * "action restricted; reason: organization is managed by Vercel".
   */
  db: z
    .object({
      /**
       * Database provider. Currently only Neon is supported — the
       * field exists to mirror the `kind` pattern in `tracker` and
       * `secrets` and to leave room for alternatives (Supabase, RDS)
       * without a breaking schema change.
       */
      kind: z.enum(['neon']).default('neon'),
      managedBy: z.enum(['standalone', 'vercel']).default('standalone'),
      /**
       * Vercel marketplace plan for `vercel install neon`. Vercel
       * versioned these (`free` → `free_v3` etc.) — keep this in sync
       * with the upstream marketplace.
       */
      plan: z.string().min(1).default('free_v3'),
    })
    .optional(),

  /**
   * Test-tooling integrations. `testing.api` configures the tool that
   * mirrors / exercises the API surface — currently only Postman is
   * wired up, but the `kind` discriminator leaves room for swaps
   * (Insomnia, Bruno, Newman-only CI) without a schema break. Optional;
   * `rando api postman sync` + `rando init`'s Postman step both read
   * this. `workspaceId` can also be passed via `--workspace` on the CLI.
   */
  testing: z
    .object({
      api: z
        .object({
          kind: z.enum(['postman']).default('postman'),
          workspaceId: z.string().min(1).optional(),
          /** Collection name shown in Postman. Defaults to "Rando API". */
          collectionName: z.string().min(1).optional(),
        })
        .optional(),
    })
    .optional(),

  /**
   * 1Password Secret-manager integration. When set, `rando init`,
   * `rando secrets sync`, and `rando secrets set` route every secret
   * through the configured 1Password **Environment** before/instead
   * of touching `.env`.
   *
   * Convention: item title === env var name (e.g. NEON_API_KEY →
   * `op://<environment-id>/NEON_API_KEY/<field>` for user-account
   * access, or `op environment read <environment-id>` for service
   * accounts in CI). Adding a new env var means adding an item with
   * that name to whichever Environment(s) need it.
   *
   * Note: these are 1Password **Environments**, not Vaults — distinct
   * 1Password features. Vault-based references (`op read op://...`)
   * work only for user accounts; CI service accounts use
   * `op environment read` to stream the whole Environment as
   * KEY=VALUE pairs.
   */
  secrets: z
    .object({
      kind: z.enum(['1password']).default('1password'),
      /**
       * 1Password account UUID — passed as --account on every `op`
       * call so commands always target the right account, even when
       * the user has multiple accounts configured. Find it via
       * `op account list --format=json`.
       */
      account: z.string().min(1).optional(),
      /** Field on each item that holds the credential value. */
      field: z.string().min(1).default('credential'),
      /**
       * 1Password Environment IDs per deploy environment. `local` is
       * required since it's the default for everyday dev work;
       * `staging` + `prod` are optional until you need them. Find IDs
       * via the 1Password desktop app's Developer panel.
       */
      environments: z.object({
        local: z.string().min(1),
        staging: z.string().min(1).optional(),
        prod: z.string().min(1).optional(),
      }),
    })
    .optional(),
})

/** Valid env names for the `secrets.environments` block. */
export type SecretsEnv = 'local' | 'staging' | 'prod'
export const ALL_SECRETS_ENVS: SecretsEnv[] = ['local', 'staging', 'prod']

export type SetupConfig = z.infer<typeof SetupConfigSchema>

export class SetupConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SetupConfigError'
  }
}

/** Load + parse a config from a path. Surfaces friendly errors on bad JSON / bad shape. */
export function loadSetupConfig(path: string): SetupConfig {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new SetupConfigError(`Could not read config at ${path}: ${detail}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new SetupConfigError(`Config at ${path} is not valid JSON: ${detail}`)
  }
  const result = SetupConfigSchema.safeParse(parsed)
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue?.path.join('.') ?? '<root>'
    throw new SetupConfigError(
      `Config at ${path} is invalid: ${where} — ${issue?.message ?? 'unknown'}`,
    )
  }
  return result.data
}

// --- helpers used by the orchestration command -----------------------------

export type SetupEnv = 'dev' | 'staging' | 'production'
export const ALL_ENVS: SetupEnv[] = ['dev', 'staging', 'production']

/** Stable per-(env, app) hostname under the configured zones. */
export function hostnameFor(
  config: SetupConfig,
  env: SetupEnv,
  app: SetupConfig['apps'][number],
): string {
  if (env === 'dev') return `dev-${app.name}.${config.domains.nonProd}`
  if (env === 'staging') return `staging-${app.name}.${config.domains.nonProd}`
  if (env === 'production') {
    return app.prodApex ? config.domains.production : `${app.name}.${config.domains.production}`
  }
  throw new Error(`Unknown env: ${env satisfies never}`)
}

/** Vercel project name convention: "<project>-<app>". */
export function vercelProjectName(config: SetupConfig, app: SetupConfig['apps'][number]): string {
  return `${config.project}-${app.name}`
}
