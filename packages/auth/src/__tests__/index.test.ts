import { describe, expect, it } from 'vitest'
import { brandClerkId } from '../index'

describe('brandClerkId', () => {
  it('returns the same string value with a branded type', () => {
    const id = brandClerkId('clerk_abc123')
    expect(id).toBe('clerk_abc123')
  })

  it('preserves empty string', () => {
    const id = brandClerkId('')
    expect(id).toBe('')
  })
})
