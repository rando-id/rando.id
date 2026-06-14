// Read + merge .env files. Writes preserve comments and blank lines —
// we only touch the lines for the keys we're setting.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** Parse a .env file into an ordered list of lines + a key index. */
export interface EnvFile {
  lines: string[]
  /** Map of key → line index. */
  index: Map<string, number>
}

export function readEnv(path: string): EnvFile {
  if (!existsSync(path)) return { lines: [], index: new Map() }
  const lines = readFileSync(path, 'utf-8').split('\n')
  const index = new Map<string, number>()
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? '').match(/^([A-Z][A-Z0-9_]*)=/)
    if (m) index.set(m[1] ?? '', i)
  }
  return { lines, index }
}

/** In-place upsert: replace the line for `key` or append it. */
export function setEnvValue(env: EnvFile, key: string, value: string): void {
  // Escape backslash, dollar, and double-quote — POSIX shell semantics
  // for the export step. Newlines are not allowed; .env can't carry them.
  const safe = value.replace(/[\\$"]/g, (m) => `\\${m}`)
  const formatted = `${key}=${safe}`
  const existing = env.index.get(key)
  if (existing !== undefined) {
    env.lines[existing] = formatted
  } else {
    env.lines.push(formatted)
    env.index.set(key, env.lines.length - 1)
  }
}

export function writeEnv(path: string, env: EnvFile): void {
  let body = env.lines.join('\n')
  // Always end with a single trailing newline so future reads don't
  // ambiguously combine the last value with appended content.
  if (!body.endsWith('\n')) body += '\n'
  writeFileSync(path, body, 'utf-8')
}
