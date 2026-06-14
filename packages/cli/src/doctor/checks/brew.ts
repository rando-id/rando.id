// Brewfile satisfaction check. macOS-only — on Linux/Windows `brew`
// won't be on PATH so we warn (rather than fail) and let the user
// install the deps however they want.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Check, CheckResult } from '../types'

function brewInstalled(): boolean {
  try {
    execFileSync('brew', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    return true
  } catch {
    return false
  }
}

function brewBundleStatus(brewfilePath: string): {
  satisfied: boolean
  missing: string[]
} {
  try {
    execFileSync('brew', ['bundle', 'check', '--file', brewfilePath, '--verbose'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { satisfied: true, missing: [] }
  } catch (e) {
    const stdout = (e as { stdout?: Buffer }).stdout?.toString('utf-8') ?? ''
    const stderr = (e as { stderr?: Buffer }).stderr?.toString('utf-8') ?? ''
    // --verbose output: lines like
    //   "→ Formula gh needs to be installed or updated."
    //   "→ Cask orbstack needs to be installed or updated."
    const missing: string[] = []
    for (const line of (stdout + stderr).split('\n')) {
      const m = line.match(/^→\s+(?:Formula|Cask|Tap|Mas)\s+(\S+)\s+needs/i)
      if (m && m[1]) missing.push(m[1])
    }
    return { satisfied: false, missing }
  }
}

export function brewChecks(repoRoot = process.cwd()): Check[] {
  // Brewfile lives under scripts/ for tidy repo-root organization.
  // Older clones may still have it at the root; check both.
  const candidates = [resolve(repoRoot, 'scripts/Brewfile'), resolve(repoRoot, 'Brewfile')]
  const brewfilePath = candidates.find((p) => existsSync(p)) ?? candidates[0]!
  const hasBrewfile = existsSync(brewfilePath)

  return [
    {
      section: 'Local',
      name: 'brew + Brewfile',
      async run(): Promise<CheckResult> {
        if (!hasBrewfile) {
          // No Brewfile in this repo — skip silently. (Linux + Windows
          // setups don't need one.)
          return {
            status: 'ok',
            subject: 'no Brewfile in repo (skipped)',
          }
        }
        if (!brewInstalled()) {
          return {
            status: 'warn',
            subject: 'brew not installed (macOS only)',
            hint: 'Brewfile is present but you have no `brew`. Install manually or skip on non-macOS.',
            fix: 'brew:install',
          }
        }
        const status = brewBundleStatus(brewfilePath)
        if (status.satisfied) {
          return { status: 'ok', subject: 'all Brewfile deps installed' }
        }
        const list =
          status.missing.length > 0
            ? status.missing.join(', ')
            : 'see `brew bundle check --verbose`'
        return {
          status: 'warn',
          subject: `missing: ${list}`,
          hint: 'run `brew bundle install` (or `rando init` to install interactively)',
          fix: 'brew:bundle',
        }
      },
    },
  ]
}
