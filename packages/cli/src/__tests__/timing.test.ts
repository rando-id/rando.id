import { describe, expect, it } from 'vitest'
import { formatDuration, startTimer } from '../timing'

describe('formatDuration', () => {
  it('renders sub-second durations as fractional seconds', () => {
    expect(formatDuration(0)).toBe('0.0s')
    // 851ms avoids the 0.85 banker's-rounding edge case (which can land at 0.8).
    expect(formatDuration(851)).toBe('0.9s')
    expect(formatDuration(999)).toBe('1.0s')
  })

  it('renders 1–59 seconds as whole seconds', () => {
    expect(formatDuration(1_000)).toBe('1s')
    expect(formatDuration(12_400)).toBe('12s')
    expect(formatDuration(59_400)).toBe('59s')
  })

  it('renders 1–59 minutes as MmSSs', () => {
    expect(formatDuration(60_000)).toBe('1m00s')
    expect(formatDuration(125_000)).toBe('2m05s')
    expect(formatDuration(59 * 60 * 1000 + 30_000)).toBe('59m30s')
  })

  it('renders ≥1 hour as HhMMmSSs', () => {
    expect(formatDuration(3_605_000)).toBe('1h00m05s')
    expect(formatDuration(2 * 3_600_000 + 15 * 60_000 + 7_000)).toBe('2h15m07s')
  })
})

describe('startTimer', () => {
  it('returns a function that yields elapsed milliseconds', async () => {
    const elapsed = startTimer()
    await new Promise((r) => setTimeout(r, 25))
    const v = elapsed()
    expect(v).toBeGreaterThanOrEqual(20)
    expect(v).toBeLessThan(500)
  })

  it('can be called multiple times — each returns the latest delta', async () => {
    const elapsed = startTimer()
    await new Promise((r) => setTimeout(r, 10))
    const first = elapsed()
    await new Promise((r) => setTimeout(r, 10))
    const second = elapsed()
    expect(second).toBeGreaterThan(first)
  })
})
