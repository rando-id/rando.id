// Output helpers. All commands route through these so output is consistent
// and easy to mock in tests.

import { createInterface } from 'node:readline/promises'

export interface Io {
  stdout: (line: string) => void
  stderr: (line: string) => void
  /** Ask the user to confirm a destructive action. Returns true on y/yes. */
  confirm: (message: string) => Promise<boolean>
}

export const defaultIo: Io = {
  stdout: (line) => process.stdout.write(line + '\n'),
  stderr: (line) => process.stderr.write(line + '\n'),
  confirm: async (message) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      const answer = (await rl.question(`${message} `)).trim().toLowerCase()
      return answer === 'y' || answer === 'yes'
    } finally {
      rl.close()
    }
  },
}

/** Print either JSON (when `--json`) or a human-readable rendering. */
export function emit<T>(io: Io, json: boolean, value: T, render: (v: T) => string): void {
  if (json) {
    io.stdout(JSON.stringify(value, null, 2))
  } else {
    io.stdout(render(value))
  }
}

export function table(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return '(no results)'
  const keys = Object.keys(rows[0] ?? {})
  const widths: Record<string, number> = {}
  for (const key of keys) {
    widths[key] = Math.max(key.length, ...rows.map((r) => (r[key] ?? '').toString().length))
  }
  const header = keys.map((k) => k.padEnd(widths[k] ?? 0)).join('  ')
  const sep = keys.map((k) => '-'.repeat(widths[k] ?? 0)).join('  ')
  const body = rows
    .map((r) => keys.map((k) => (r[k] ?? '').toString().padEnd(widths[k] ?? 0)).join('  '))
    .join('\n')
  return `${header}\n${sep}\n${body}`
}
