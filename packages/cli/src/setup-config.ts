// Loads + validates `rando.config.json`. The schema itself lives in
// @rando/config so apps can import the type without dragging in the CLI's
// runtime deps; this file owns the file-I/O wrapper and the orchestrator
// helpers (hostnameFor, vercelProjectName) the CLI commands need.

import { readFileSync } from 'node:fs'
import {
  SetupConfigSchema,
  type SetupConfig,
  type SecretsEnv,
  ALL_SECRETS_ENVS,
} from '@rando/config'

export { SetupConfigSchema, ALL_SECRETS_ENVS }
export type { SetupConfig, SecretsEnv }

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
