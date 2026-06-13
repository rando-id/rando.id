import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createDb = vi.fn()
vi.mock('@rando/db', () => ({ createDb }))

beforeEach(() => {
  vi.resetModules()
  createDb.mockReset()
  createDb.mockImplementation((url: string) => ({ url }))
})

afterEach(() => {
  delete process.env.DATABASE_URL
})

describe('getDb', () => {
  it('throws when DATABASE_URL is not set', async () => {
    const { getDb } = await import('../db')
    expect(() => getDb()).toThrow(/DATABASE_URL/)
  })

  it('builds a single db client per process (memoized)', async () => {
    process.env.DATABASE_URL = 'postgres://test'
    const { getDb } = await import('../db')
    const a = getDb()
    const b = getDb()
    expect(a).toBe(b)
    expect(createDb).toHaveBeenCalledTimes(1)
    expect(createDb).toHaveBeenCalledWith('postgres://test')
  })
})
