#!/usr/bin/env node
// Lint the live `/v1/openapi.json` spec via `postman api lint`.
//
// Two wrinkles `postman api lint` has that this script papers over:
//   1. It only accepts local file paths or Postman API IDs — not URLs.
//      We fetch the spec to a temp file first.
//   2. It fetches rulesets from Postman cloud and needs an active
//      login session. We re-authenticate with `POSTMAN_API_KEY` on
//      every run (idempotent — login overwrites the cached token).
//
// Usage:
//   pnpm spec:lint                                       # local API on port 4000
//   SPEC_URL=https://staging-api.rando-id.dev pnpm spec:lint
//   SPEC_PATH=./postman/snapshot.json pnpm spec:lint     # skip fetch, lint a file directly

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Load .env into process.env if it isn't already populated — pnpm
// scripts don't pick it up automatically the way the rando bin
// shebang does. Best-effort: no failure if .env is missing.
loadDotEnv(resolve(process.cwd(), '.env'))

const SPEC_PATH = process.env.SPEC_PATH
const SPEC_URL = process.env.SPEC_URL ?? 'http://localhost:4000/v1/openapi.json'
const POSTMAN_API_KEY = process.env.POSTMAN_API_KEY

if (!POSTMAN_API_KEY) {
  console.error(
    '✗ POSTMAN_API_KEY not set. `postman api lint` needs to authenticate to fetch the ruleset.',
  )
  console.error('  Sync it from 1Password: `rando secrets sync`')
  process.exit(1)
}

// Refresh the login session token. Idempotent — login overwrites
// whatever's cached. Only runs once per spec-lint invocation, so the
// cost is one HTTP round-trip.
const login = spawnSync('node_modules/.bin/postman', ['login', '--with-api-key', POSTMAN_API_KEY], {
  stdio: ['ignore', 'ignore', 'inherit'],
})
if (login.status !== 0) {
  console.error('✗ `postman login` failed — see stderr above.')
  process.exit(login.status ?? 1)
}

async function resolveSpec() {
  if (SPEC_PATH) {
    return { path: SPEC_PATH, cleanup: () => {} }
  }
  const res = await fetch(SPEC_URL)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${SPEC_URL}: ${res.status} ${res.statusText}`)
  }
  const spec = await res.text()
  const dir = mkdtempSync(join(tmpdir(), 'rando-spec-lint-'))
  const path = join(dir, 'openapi.json')
  writeFileSync(path, spec, 'utf-8')
  return {
    path,
    cleanup: () => {
      try {
        unlinkSync(path)
      } catch {
        // Best-effort — tmp dir gets cleaned by the OS regardless.
      }
    },
  }
}

const { path, cleanup } = await resolveSpec()
try {
  const result = spawnSync(
    'node_modules/.bin/postman',
    ['api', 'lint', path, '--fail-severity', 'error'],
    { stdio: 'inherit' },
  )
  process.exit(result.status ?? 1)
} finally {
  cleanup()
}

/**
 * Parse a `.env` file and populate process.env for any keys not
 * already set. Mirrors the subset of dotenv semantics `rando` already
 * uses via `--env-file-if-exists`: no quoting magic, no expansion,
 * just `KEY=value` lines.
 */
function loadDotEnv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq)
    if (process.env[key] != null) continue
    let value = trimmed.slice(eq + 1)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}
