// Husky shim + hook installation check. We expect:
//   - .husky/{pre-commit,prepare-commit-msg,commit-msg} present + executable
//   - .husky/_/* shims regenerated (which means `pnpm install` ran)
//   - git core.hooksPath pointing at .husky/_

import { existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Check, CheckResult } from '../types'

const REQUIRED_HOOKS = ['pre-commit', 'prepare-commit-msg', 'commit-msg']

function isExecutable(path: string): boolean {
  try {
    return (statSync(path).mode & 0o111) !== 0
  } catch {
    return false
  }
}

export function hooksChecks(repoRoot = process.cwd()): Check[] {
  return [
    {
      section: 'Hooks',
      name: 'husky shims (.husky/_/)',
      async run(): Promise<CheckResult> {
        const shimDir = resolve(repoRoot, '.husky/_')
        if (!existsSync(shimDir)) {
          return {
            status: 'fail',
            subject: 'not generated',
            hint: "run `pnpm install` — husky's prepare script regenerates the shim layer",
            fix: 'hooks:install',
          }
        }
        return { status: 'ok', subject: 'present' }
      },
    },
    {
      section: 'Hooks',
      name: 'core.hooksPath',
      async run(): Promise<CheckResult> {
        try {
          const value = execFileSync('git', ['-C', repoRoot, 'config', 'core.hooksPath'], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim()
          if (value === '.husky/_') return { status: 'ok', subject: value }
          return {
            status: 'fail',
            subject: `points at "${value}"`,
            hint: 'expected ".husky/_" — run `pnpm install` to fix',
            fix: 'hooks:install',
          }
        } catch {
          return {
            status: 'fail',
            subject: 'unset',
            hint: 'run `pnpm install` to wire husky',
            fix: 'hooks:install',
          }
        }
      },
    },
    ...REQUIRED_HOOKS.map(
      (name): Check => ({
        section: 'Hooks',
        name: `.husky/${name}`,
        async run(): Promise<CheckResult> {
          const path = resolve(repoRoot, '.husky', name)
          if (!existsSync(path)) {
            return {
              status: 'fail',
              subject: 'missing',
              hint: `expected at ${path}`,
              fix: 'hooks:install',
            }
          }
          if (!isExecutable(path)) {
            return {
              status: 'warn',
              subject: 'not executable',
              hint: `chmod +x ${path}`,
              fix: 'hooks:perms',
            }
          }
          return { status: 'ok', subject: 'present + executable' }
        },
      }),
    ),
  ]
}
