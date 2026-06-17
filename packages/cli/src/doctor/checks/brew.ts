// Brewfile satisfaction check. macOS-only — on Linux/Windows `brew`
// won't be on PATH so we warn (rather than fail) and let the user
// install the deps however they want.
//
// Smart-detection: many tools in scripts/Brewfile can also come from
// elsewhere (pnpm via corepack, op via the 1Password desktop app,
// docker via Docker Desktop, node via nvm/n). The check filters out
// formulae whose primary command is already on PATH so users with
// mixed toolchains don't see false-positive warnings.

import { execFileSync, spawnSync } from 'node:child_process'
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

/**
 * Map of Brewfile formula/cask name → command(s) we expect on PATH
 * when the tool is available. If ANY of the commands resolves, we
 * treat the formula as "installed via an alternate route" and don't
 * warn about it.
 *
 * Add new entries here whenever a Brewfile line could plausibly be
 * satisfied by a non-brew install (npm global, .dmg, app store, etc.).
 */
const ALT_INSTALL_PROBES: Record<string, string[]> = {
  // Casks
  orbstack: ['orb', 'docker'],
  docker: ['docker'],
  // Container runtimes / DBs that Docker Desktop / Postgres.app might provide
  'postgresql@16': ['pg_dump', 'pg_restore', 'psql'],
  'postgresql@15': ['pg_dump'],
  // Tools commonly installed via npm / corepack / etc.
  pnpm: ['pnpm'],
  yarn: ['yarn'],
  node: ['node'],
  'node@22': ['node'],
  'node@20': ['node'],
  // CLI-with-companion-app pattern
  '1password-cli': ['op'],
  gh: ['gh'],
  cloudflared: ['cloudflared'],
  'postman-cli': ['postman'],
}

/**
 * Does the named formula have a working command available somewhere
 * on PATH? Conservative: if the formula isn't in our probe table we
 * return false (so brew's own answer wins).
 */
function isAlternativelyInstalled(formula: string): boolean {
  const probes = ALT_INSTALL_PROBES[formula]
  if (!probes) return false
  for (const cmd of probes) {
    const result = spawnSync('command', ['-v', cmd], { shell: '/bin/sh', stdio: 'pipe' })
    if (result.status === 0) return true
  }
  return false
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
        // Filter out formulae whose primary command is on PATH — they
        // were installed via some other route (npm, app store, manual
        // download) and work fine. Only flag the ones that are
        // genuinely missing AND have no alternate install detected.
        const reallyMissing = status.missing.filter((name) => !isAlternativelyInstalled(name))
        if (reallyMissing.length === 0) {
          return {
            status: 'ok',
            subject: 'all Brewfile deps available (some via alt installs)',
          }
        }
        return {
          status: 'warn',
          subject: `missing: ${reallyMissing.join(', ')}`,
          hint: 'run `brew bundle install` (or `rando init` to install interactively)',
          fix: 'brew:bundle',
        }
      },
    },
  ]
}
