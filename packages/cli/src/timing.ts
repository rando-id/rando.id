// Small timing helpers used by long-running commands. Kept tiny + pure so
// they're trivial to test and don't drag in any I/O.

/**
 * Format a duration in milliseconds as a compact human-readable string:
 *   850ms     → "0.9s"
 *   12_400ms  → "12s"
 *   125_000ms → "2m05s"
 *   3_605_000 → "1h00m05s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return `${m}m${rs.toString().padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h${rm.toString().padStart(2, '0')}m${rs.toString().padStart(2, '0')}s`
}

/** Start a timer that returns elapsed-ms when stopped. */
export function startTimer(): () => number {
  const t0 = performance.now()
  return () => performance.now() - t0
}
