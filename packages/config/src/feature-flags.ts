export type SubscriptionTier = 'free' | 'pro'

export type FeatureFlag =
  | 'auto-seasonal-themes'
  | 'random-avatars'
  | 'artist-curated-lists'
  | 'whatsapp-integration'

export const FEATURE_TIERS: Record<FeatureFlag, SubscriptionTier> = {
  'auto-seasonal-themes': 'pro',
  'random-avatars': 'pro',
  'artist-curated-lists': 'pro',
  'whatsapp-integration': 'free',
}

export function canUse(tier: SubscriptionTier, flag: FeatureFlag): boolean {
  const required = FEATURE_TIERS[flag]
  if (required === 'free') return true
  return tier === 'pro'
}
