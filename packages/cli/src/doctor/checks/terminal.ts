// Terminal-rendering check — chalk level + isTTY. Used to live as the
// entire `rando doctor` command; now it's one section of the broader
// doctor sweep.

import chalk from 'chalk'
import type { Check, CheckResult } from '../types'

export function terminalChecks(): Check[] {
  return [
    {
      section: 'Terminal',
      name: 'isTTY',
      async run(): Promise<CheckResult> {
        const tty = process.stdout.isTTY === true
        if (tty) return { status: 'ok', subject: 'true' }
        return {
          status: 'warn',
          subject: 'false / undefined',
          hint:
            'colors + spinners will be disabled. Try `FORCE_COLOR=1 rando doctor`; ' +
            "see `rando doctor`'s own diagnostic for finer detail.",
          fix: 'terminal:tty',
        }
      },
    },
    {
      section: 'Terminal',
      name: 'chalk level',
      async run(): Promise<CheckResult> {
        if (chalk.level === 0) {
          return {
            status: 'warn',
            subject: '0 (colors off)',
            hint: 'set FORCE_COLOR=1 to override, or check NO_COLOR + TERM',
            fix: 'terminal:chalk',
          }
        }
        return { status: 'ok', subject: String(chalk.level) }
      },
    },
  ]
}
