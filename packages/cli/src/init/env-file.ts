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

/**
 * Read the literal value for `key` from a parsed env file. Returns
 * undefined when the key isn't present. Strips matching surrounding
 * quotes — values can be written `KEY=foo` or `KEY="foo"` and either
 * form should round-trip the same string back.
 */
export function getEnvValue(env: EnvFile, key: string): string | undefined {
  const i = env.index.get(key)
  if (i === undefined) return undefined
  const line = env.lines[i] ?? ''
  const eq = line.indexOf('=')
  if (eq < 0) return undefined
  const raw = line.slice(eq + 1)
  // Strip a single matching pair of surrounding quotes.
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1)
  }
  return raw
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
