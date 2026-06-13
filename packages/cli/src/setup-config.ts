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
   * Jira ticket-tracker integration. Optional — when absent, `rando jira`
   * commands and the commit hook still work but they can't auto-transition
   * tickets through the Rando-specific lifecycle (PR open → In Progress,
   * branch deploy → In Review, merge → Done) because those statuses are
   * per-project and not predictable.
   *
   * Run `rando jira doctor` to discover what's available in your project,
   * then fill in `transitions` with the matching transition names or ids.
   */
  jira: z
    .object({
      /** Project key, e.g. "RANDO". */
      projectKey: z.string().min(1),
      /**
       * Map from semantic lifecycle state → Jira transition name OR id.
       * Either works; the doctor command shows both.
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
