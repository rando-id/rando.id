import { describe, expect, it } from 'vitest'
import { sharedEnvSchema } from '../env'

describe('sharedEnvSchema', () => {
  it('accepts a complete valid env', () => {
    const result = sharedEnvSchema.safeParse({
      NODE_ENV: 'production',
      RANDO_API_URL: 'https://api.rando.id',
    })
    expect(result.success).toBe(true)
  })

  it('defaults NODE_ENV to development when omitted', () => {
    const result = sharedEnvSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development')
    }
  })

  it('accepts all valid NODE_ENV values', () => {
    for (const env of ['development', 'test', 'production'] as const) {
      const result = sharedEnvSchema.safeParse({ NODE_ENV: env })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid NODE_ENV values', () => {
    const result = sharedEnvSchema.safeParse({ NODE_ENV: 'staging' })
    expect(result.success).toBe(false)
  })

  it('RANDO_API_URL is optional', () => {
    const result = sharedEnvSchema.safeParse({ NODE_ENV: 'test' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.RANDO_API_URL).toBeUndefined()
    }
  })

  it('rejects RANDO_API_URL when not a valid URL', () => {
    const result = sharedEnvSchema.safeParse({
      NODE_ENV: 'test',
      RANDO_API_URL: 'not-a-url',
    })
    expect(result.success).toBe(false)
  })
})
