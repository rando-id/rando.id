// Tracker check — delegates to the configured adapter's doctor()
// method and surfaces a single ok/warn/fail row plus per-slot rows
// for the lifecycle map (in-progress / in-review / done).

import type { Adapters } from '../../config'
import { MissingConfigError } from '../../domain/errors'
import type { Check, CheckResult } from '../types'

export function trackerChecks(adapters: Adapters, configPath = 'rando.config.json'): Check[] {
  return [
    {
      section: 'Tracker',
      name: 'auth + project',
      async run(): Promise<CheckResult> {
        try {
          const report = await adapters.tracker({ configPath }).doctor()
          return {
            status: 'ok',
            subject: `${report.authedAs} → ${report.projectLabel}`,
          }
        } catch (e) {
          if (e instanceof MissingConfigError) {
            return {
              status: 'warn',
              subject: 'not configured',
              hint: `${e.variable} unset — fill in to enable issue integration`,
              fix: `env:${e.variable}`,
            }
          }
          return {
            status: 'fail',
            subject: 'doctor failed',
            hint: e instanceof Error ? e.message : String(e),
            fix: 'tracker:doctor',
          }
        }
      },
    },
    {
      section: 'Tracker',
      name: 'lifecycle map',
      async run(): Promise<CheckResult> {
        try {
          const report = await adapters.tracker({ configPath }).doctor()
          const unresolved = report.lifecycle.filter((l) => !l.resolved)
          if (unresolved.length === 0) {
            return { status: 'ok', subject: 'all slots resolved' }
          }
          const slots = unresolved.map((u) => u.slot).join(', ')
          return {
            status: 'warn',
            subject: `${unresolved.length} unmapped: ${slots}`,
            hint: 'see `rando issues doctor` for the per-slot details',
            fix: 'tracker:lifecycle',
          }
        } catch {
          // Tracker not configured at all — caught by the first check above.
          return { status: 'ok', subject: 'skipped (tracker not configured)' }
        }
      },
    },
  ]
}
