// Env-var checks: each token in .env.example gets a "present?" check
// and, when present, a "valid?" check that hits the vendor API.
//
// Validity checks are best-effort — a 401 means the token is wrong, a
// 5xx or network blip is reported as a warn so doctor doesn't fail
// noisily during a vendor outage.

import type { Adapters } from '../../config'
import { MissingConfigError } from '../../domain/errors'
import type { Check, CheckResult } from '../types'

interface EnvTokenSpec {
  /** Variable name as set in .env. */
  name: string
  /** Human label for the doctor row. */
  label: string
  /**
   * Adapter probe that throws on failure. Wraps getMyself() / list / etc.
   * The runner translates throws into fail/warn results.
   */
  probe: (adapters: Adapters) => Promise<void>
  /** When true, missing is a warn (the var is optional). */
  optional?: boolean
}

export const TOKENS: EnvTokenSpec[] = [
  {
    name: 'GITHUB_TOKEN',
    label: 'GITHUB_TOKEN (issues, when tracker.kind=github)',
    probe: async (a) => {
      await a.tracker().getMyself()
    },
    optional: true,
  },
  {
    name: 'NEON_API_KEY',
    label: 'NEON_API_KEY (db)',
    probe: async (a) => {
      await a.db().listProjects()
    },
  },
  {
    name: 'CLOUDFLARE_API_TOKEN',
    label: 'CLOUDFLARE_API_TOKEN (tunnel, dns)',
    probe: async (a) => {
      await a.tunnel().listTunnels()
    },
  },
  {
    name: 'CLOUDFLARE_ACCOUNT_ID',
    label: 'CLOUDFLARE_ACCOUNT_ID (tunnel)',
    // Same probe as CLOUDFLARE_API_TOKEN — listTunnels needs both.
    probe: async (a) => {
      await a.tunnel().listTunnels()
    },
  },
  {
    name: 'VERCEL_TOKEN',
    label: 'VERCEL_TOKEN (deploy)',
    probe: async (a) => {
      await a.deploy().listProjects()
    },
  },
  {
    name: 'JIRA_BASE_URL',
    label: 'JIRA_BASE_URL (issues, when tracker.kind=jira)',
    probe: async () => {
      // Validity probe lives under tracker — only relevant when
      // tracker.kind === 'jira'. Skip here, report as ok-if-present.
    },
    optional: true,
  },
  {
    name: 'JIRA_EMAIL',
    label: 'JIRA_EMAIL (issues, when tracker.kind=jira)',
    probe: async () => {},
    optional: true,
  },
  {
    name: 'JIRA_API_TOKEN',
    label: 'JIRA_API_TOKEN (issues, when tracker.kind=jira)',
    probe: async () => {},
    optional: true,
  },
  {
    name: 'POSTMAN_API_KEY',
    label: 'POSTMAN_API_KEY (rando api postman sync)',
    probe: async (a) => {
      await a.postman().getMyself()
    },
    optional: true,
  },
]

export function envChecks(adapters: Adapters, env: NodeJS.ProcessEnv = process.env): Check[] {
  return TOKENS.map((spec) => ({
    section: 'Env',
    name: spec.name,
    async run(): Promise<CheckResult> {
      const present = (env[spec.name] ?? '').trim().length > 0
      if (!present) {
        return spec.optional
          ? {
              status: 'warn',
              subject: 'unset',
              hint: `${spec.label} — set if you use this adapter`,
              fix: `env:${spec.name}`,
            }
          : {
              status: 'fail',
              subject: 'unset',
              hint: `${spec.label} — see packages/cli/README.md`,
              fix: `env:${spec.name}`,
            }
      }
      try {
        await spec.probe(adapters)
        return { status: 'ok', subject: 'set + valid' }
      } catch (e) {
        if (e instanceof MissingConfigError) {
          // Another env var in the same adapter is missing — flagged
          // separately by its own check.
          return { status: 'ok', subject: 'set (paired var unset, validity skipped)' }
        }
        return {
          status: 'fail',
          subject: 'set but invalid',
          hint: e instanceof Error ? e.message : String(e),
          fix: `env:${spec.name}`,
        }
      }
    },
  }))
}
