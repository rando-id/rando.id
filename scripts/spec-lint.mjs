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
  // Pass Vercel's Protection Bypass header when the env var is set
  // (CI flow loads it from the staging 1Password Environment). Without
  // this, fetching from a preview URL gets 302'd to vercel.com/sso-api
  // and the spec content is the SSO HTML page, not JSON.
  // .notes/ci-vercel-protection-bypass.spec.md.
  //
  // SECURITY: the response body is untrusted network data and we're
  // about to hand it to `postman api lint`, which reads it as a spec
  // file. CodeQL's "Network data written to file" rule flags any flow
  // from `fetch().text()` → `writeFileSync`. The path is already safe
  // (`mkdtempSync` random dir + hardcoded `openapi.json` — no user-
  // controlled path component); the content side is hardened with
  // four defense layers: (1) `redirect: 'error'` refuses 3xx, (2)
  // Content-Type must claim JSON, (3) body must `JSON.parse` cleanly,
  // (4) the bytes that land on disk are `JSON.stringify`'d from the
  // parsed object — NOT the raw response text. The round-trip is the
  // sanitizer: the value written has no data-flow lineage to the
  // network source, so CodeQL's taint tracking sees a clean break,
  // and it's a real guarantee that what gets written is structurally
  // valid JSON (no smuggled control chars, null bytes, or
  // encoding tricks JSON.parse rejects).
  const headers = { accept: 'application/json' }
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  }
  // redirect: 'error' refuses to follow 3xx responses. The Vercel SSO
  // gate redirects to vercel.com/sso-api on protection-failure; we'd
  // rather see a clear error than silently follow into HTML-land.
  let res
  try {
    res = await fetch(SPEC_URL, { headers, redirect: 'error' })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Failed to fetch ${SPEC_URL}: ${detail}. ` +
        `If this is a Vercel preview URL, set VERCEL_AUTOMATION_BYPASS_SECRET ` +
        `to bypass Deployment Protection (see .notes/ci-vercel-protection-bypass.spec.md).`,
    )
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch ${SPEC_URL}: ${res.status} ${res.statusText}`)
  }
  const contentType = res.headers.get('content-type') ?? ''
  if (!/^application\/(json|.*\+json)\b/i.test(contentType)) {
    throw new Error(
      `Expected JSON spec from ${SPEC_URL}, got Content-Type "${contentType}". ` +
        `Likely Deployment Protection redirected to the SSO interstitial — set ` +
        `VERCEL_AUTOMATION_BYPASS_SECRET (see .notes/ci-vercel-protection-bypass.spec.md).`,
    )
  }
  const body = await res.text()
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new Error(`Response from ${SPEC_URL} did not parse as JSON: ${detail}`)
  }
  // Re-serialize from the parsed object instead of writing the raw
  // network body. The round-trip is a real sanitizer (no possibility
  // of smuggled control chars / null bytes / encoding tricks the
  // JSON.parse spec doesn't permit) AND it breaks CodeQL's
  // taint-tracking from `fetch().text()` → `writeFileSync` — the
  // serialized string is a new value with no data-flow lineage to
  // the network source. CodeQL alert
  // https://github.com/rando-id/rando.id/security/code-scanning/8.
  const sanitized = JSON.stringify(parsed)
  const dir = mkdtempSync(join(tmpdir(), 'rando-spec-lint-'))
  const path = join(dir, 'openapi.json')
  writeFileSync(path, sanitized, 'utf-8')
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
