// Local-environment checks — things on PATH and Node version. None of
// these are deal-breakers in isolation (db copy needs pg_dump, dev
// needs gh, etc.) so each annotates the use case in its hint.

import { execFileSync } from 'node:child_process'
import type { Check, CheckResult } from '../types'

const MIN_NODE_MAJOR = 22

function which(cmd: string): string | null {
  try {
    return (
      execFileSync('command', ['-v', cmd], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: '/bin/sh',
      }).trim() || null
    )
  } catch {
    return null
  }
}

function commandVersion(cmd: string, arg = '--version'): string | null {
  try {
    return (
      execFileSync(cmd, [arg], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .trim()
        .split('\n')[0] ?? null
    )
  } catch {
    return null
  }
}

export function localChecks(): Check[] {
  return [
    {
      section: 'Local',
      name: 'Node ≥22',
      async run(): Promise<CheckResult> {
        const major = parseInt(process.versions.node.split('.')[0] ?? '0', 10)
        if (major >= MIN_NODE_MAJOR) {
          return { status: 'ok', subject: `v${process.versions.node}` }
        }
        return {
          status: 'fail',
          subject: `v${process.versions.node}`,
          hint: `Node 22+ required — install via your version manager`,
          fix: 'local:node',
        }
      },
    },
    {
      section: 'Local',
      name: 'rando on PATH',
      async run(): Promise<CheckResult> {
        const path = which('rando')
        if (path) return { status: 'ok', subject: path }
        return {
          status: 'warn',
          subject: 'not on PATH',
          hint: 'run `pnpm setup:cli` to symlink ~/.local/bin/rando — or use `pnpm rando` as a fallback',
          fix: 'local:rando-symlink',
        }
      },
    },
    {
      section: 'Local',
      name: 'gh CLI',
      async run(): Promise<CheckResult> {
        const v = commandVersion('gh')
        if (v) return { status: 'ok', subject: v }
        return {
          status: 'warn',
          subject: 'not installed',
          hint: 'gh is optional but useful for `rando issues start/ship` and PR ops — `brew install gh`',
          fix: 'local:gh',
        }
      },
    },
    {
      section: 'Local',
      name: 'pg_dump / pg_restore',
      async run(): Promise<CheckResult> {
        const dump = which('pg_dump')
        const restore = which('pg_restore')
        if (dump && restore) {
          return { status: 'ok', subject: 'present' }
        }
        // Not a warning — only `rando db copy` actually needs these,
        // and that's not a daily-driver command. Surface the gap as
        // an OK row with a subtle hint instead of polluting warnings.
        return {
          status: 'ok',
          subject: 'not installed (optional — only `rando db copy` needs them)',
        }
      },
    },
    {
      section: 'Local',
      name: 'docker (for `rando dev`)',
      async run(): Promise<CheckResult> {
        const v = commandVersion('docker')
        if (v) return { status: 'ok', subject: v }
        return {
          status: 'warn',
          subject: 'not installed',
          hint: '`rando dev` needs Docker for the local tunnel + Postgres. Docker Desktop or OrbStack.',
          fix: 'local:docker',
        }
      },
    },
  ]
}
