// rando.config.json sanity check — parses, has a tracker block, the
// repo field looks like "owner/name". The deeper schema validation
// already happens inside loadSetupConfig().

import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { loadSetupConfig } from '../../setup-config'
import type { Check, CheckResult } from '../types'

export function configChecks(configPath = 'rando.config.json'): Check[] {
  const absPath = resolve(process.cwd(), configPath)
  return [
    {
      section: 'Config',
      name: 'rando.config.json',
      async run(): Promise<CheckResult> {
        if (!existsSync(absPath)) {
          return {
            status: 'fail',
            subject: 'missing',
            hint: `expected at ${absPath} — run \`rando init\` to create one`,
            fix: 'config:missing',
          }
        }
        try {
          const cfg = loadSetupConfig(absPath)
          if (!/^[^/]+\/[^/]+$/.test(cfg.repo)) {
            return {
              status: 'fail',
              subject: 'invalid repo field',
              hint: `expected "owner/name", got "${cfg.repo}"`,
              fix: 'config:repo',
            }
          }
          if (!cfg.tracker) {
            return {
              status: 'warn',
              subject: 'no tracker block',
              hint: 'set tracker.kind = "github" | "jira" to enable issue integration',
              fix: 'config:tracker',
            }
          }
          return {
            status: 'ok',
            subject: `repo=${cfg.repo}, tracker.kind=${cfg.tracker.kind}`,
          }
        } catch (e) {
          return {
            status: 'fail',
            subject: 'invalid',
            hint: e instanceof Error ? e.message : String(e),
            fix: 'config:invalid',
          }
        }
      },
    },
  ]
}
