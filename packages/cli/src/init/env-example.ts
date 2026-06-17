// Parser for `.env.example` files. Used by the orchestrator to know
// which env vars a given app declares — the file already documents
// the contract; this just extracts the names so the orchestrator can
// route 1Password values to the right Vercel projects.
//
// Intentionally narrow: returns var NAMES only, not values. The whole
// point is "names come from .env.example, values come from 1Password."

import { existsSync, readFileSync } from 'node:fs'

/**
 * Parse an `.env.example` file and return the set of declared var
 * names. Treats `KEY=...` lines as declarations; ignores blank lines
 * and `#` comments. Returns an empty array if the file is missing —
 * callers handle the "no declared vars" case as "skip this app."
 */
export function readEnvExample(path: string): string[] {
  if (!existsSync(path)) return []
  const out: string[] = []
  for (const rawLine of readFileSync(path, 'utf-8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=/)
    if (m && m[1]) out.push(m[1])
  }
  return out
}
