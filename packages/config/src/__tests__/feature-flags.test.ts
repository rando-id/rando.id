import { describe, expect, it } from 'vitest'
import { canUse, FEATURE_TIERS } from '../feature-flags'
import type { FeatureFlag, SubscriptionTier } from '../feature-flags'

describe('FEATURE_TIERS', () => {
  it('maps every declared flag to a tier', () => {
    const flags: FeatureFlag[] = [
      'auto-seasonal-themes',
      'random-avatars',
      'artist-curated-lists',
      'whatsapp-integration',
    ]
    for (const flag of flags) {
      expect(FEATURE_TIERS[flag]).toBeDefined()
    }
  })

  it('whatsapp-integration is a free feature', () => {
    expect(FEATURE_TIERS['whatsapp-integration']).toBe('free')
  })

  it('auto-seasonal-themes is a pro feature', () => {
    expect(FEATURE_TIERS['auto-seasonal-themes']).toBe('pro')
  })
})

describe('canUse', () => {
  it('allows free users to use free features', () => {
    expect(canUse('free', 'whatsapp-integration')).toBe(true)
  })

  it('allows pro users to use free features', () => {
    expect(canUse('pro', 'whatsapp-integration')).toBe(true)
  })

  it('allows pro users to use pro features', () => {
    expect(canUse('pro', 'auto-seasonal-themes')).toBe(true)
    expect(canUse('pro', 'random-avatars')).toBe(true)
    expect(canUse('pro', 'artist-curated-lists')).toBe(true)
  })

  it('denies free users from using pro features', () => {
    expect(canUse('free', 'auto-seasonal-themes')).toBe(false)
    expect(canUse('free', 'random-avatars')).toBe(false)
    expect(canUse('free', 'artist-curated-lists')).toBe(false)
  })

  it('exhaustively covers every flag for both tiers', () => {
    const tiers: SubscriptionTier[] = ['free', 'pro']
    const flags = Object.keys(FEATURE_TIERS) as FeatureFlag[]
    for (const tier of tiers) {
      for (const flag of flags) {
        const result = canUse(tier, flag)
        expect(typeof result).toBe('boolean')
      }
    }
  })
})
