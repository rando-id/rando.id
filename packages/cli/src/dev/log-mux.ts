// Color-prefixed line multiplexer. Each child process writes a stream of
// bytes; we split on newline and prefix each line with `[<name>]` in the
// child's assigned color. Partial lines (no trailing \n) are buffered
// until the next chunk completes them.

import type { IoColors } from '../output'

/** Distinct color per app — chalk methods accessed via IoColors.* */
export type ColorKey = 'success' | 'warn' | 'resource' | 'hint' | 'bold' | 'error'

export interface LineSink {
  /** A complete line of output from one child, with prefix + color already applied. */
  (line: string): void
}

/**
 * Wrap one logical child's stdout/stderr stream. Call `write` for each
 * chunk the child emits; the line sink fires once per completed line.
 * Call `flush` when the child exits to emit any trailing partial line.
 */
export interface LineBuffer {
  write(chunk: string | Buffer): void
  flush(): void
}

/**
 * Build a prefix renderer for one app. The returned `LineBuffer` accepts
 * arbitrary chunks and calls `sink(formattedLine)` once per line.
 *
 * Format: `[<paddedName>] <line>` where the prefix is colored via the
 * given chalk method on `IoColors`. Padding keeps prefixes aligned across
 * apps so logs read like columns.
 */
export function makeLineBuffer(
  name: string,
  colors: IoColors,
  colorKey: ColorKey,
  prefixWidth: number,
  sink: LineSink,
): LineBuffer {
  let pending = ''
  const colorize = colors[colorKey]
  const prefix = colorize(`[${name.padEnd(prefixWidth)}]`)

  return {
    write(chunk) {
      pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      let nl = pending.indexOf('\n')
      while (nl !== -1) {
        const line = pending.slice(0, nl)
        sink(`${prefix} ${line}`)
        pending = pending.slice(nl + 1)
        nl = pending.indexOf('\n')
      }
    },
    flush() {
      if (pending.length > 0) {
        sink(`${prefix} ${pending}`)
        pending = ''
      }
    },
  }
}

/**
 * Assign a chalk color key to each child label. Cycles through a stable
 * palette so the assignment is deterministic across runs — easier on
 * muscle memory when you stare at the logs all day.
 */
export function assignColors(names: string[]): Map<string, ColorKey> {
  const palette: ColorKey[] = ['success', 'resource', 'warn', 'error', 'bold', 'hint']
  const map = new Map<string, ColorKey>()
  names.forEach((n, i) => {
    const color = palette[i % palette.length]
    if (color) map.set(n, color)
  })
  return map
}
