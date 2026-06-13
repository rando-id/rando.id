// Covers the non-TTY error paths in pickOr/askOr that the existing
// interactive command tests can't reach (those mock TTY=true).

import { afterEach, describe, expect, it } from 'vitest'
import { askOr, pickOr } from '../commands/_interactive'
import { captureIo } from './helpers'

// Helper: temporarily flip process.stdout.isTTY. vitest's jsdom-less
// environment may not have isTTY as an own property, so we defineProperty.
async function withTty<T>(value: boolean, fn: () => Promise<T>): Promise<T> {
  const had = Object.prototype.hasOwnProperty.call(process.stdout, 'isTTY')
  const prev = (process.stdout as { isTTY?: boolean }).isTTY
  Object.defineProperty(process.stdout, 'isTTY', {
    value,
    configurable: true,
    writable: true,
  })
  try {
    return await fn()
  } finally {
    if (had) {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: prev,
        configurable: true,
        writable: true,
      })
    } else {
      delete (process.stdout as { isTTY?: boolean }).isTTY
    }
  }
}

afterEach(() => {
  // safety
})

describe('pickOr', () => {
  it('returns the given value immediately when provided', async () => {
    const io = captureIo()
    const loader = async () => [{ name: 'a', value: 'a' }]
    const out = await pickOr(io.io, 'pre-set', loader, 'pick?', 'projectId')
    expect(out).toBe('pre-set')
  })

  it('throws a clear error in non-TTY contexts when the value is missing', async () => {
    const io = captureIo()
    const loader = async () => [{ name: 'a', value: 'a' }]
    await withTty(false, async () => {
      await expect(pickOr(io.io, undefined, loader, 'pick?', 'projectId')).rejects.toThrow(
        /Missing required argument <projectId>/,
      )
    })
  })

  it('throws "nothing to pick from" when the loader returns an empty list', async () => {
    const io = captureIo({ selectResponses: ['x'] })
    const loader = async () => []
    await withTty(true, async () => {
      await expect(pickOr(io.io, undefined, loader, 'pick?', 'argX')).rejects.toThrow(
        /nothing to pick from/,
      )
    })
  })

  it('treats empty string as missing and prompts', async () => {
    const io = captureIo({ selectResponses: ['chosen'] })
    const loader = async () => [{ name: 'chosen', value: 'chosen' }]
    await withTty(true, async () => {
      const out = await pickOr(io.io, '' as string, loader, 'pick?', 'argX')
      expect(out).toBe('chosen')
    })
  })
})

describe('askOr', () => {
  it('returns the given value immediately when provided', async () => {
    const io = captureIo()
    const out = await askOr(io.io, 'value', 'q?', 'argX')
    expect(out).toBe('value')
  })

  it('throws in non-TTY contexts when the value is missing', async () => {
    const io = captureIo()
    await withTty(false, async () => {
      await expect(askOr(io.io, undefined, 'q?', 'argX')).rejects.toThrow(
        /Missing required argument <argX>/,
      )
    })
  })

  it('prompts via io.input when in a TTY', async () => {
    const io = captureIo({ inputResponses: ['typed'] })
    await withTty(true, async () => {
      const out = await askOr(io.io, undefined, 'q?', 'argX', 'default-val')
      expect(out).toBe('typed')
      expect(io.inputCalls[0]).toEqual({ message: 'q?', default: 'default-val' })
    })
  })
})
