// Sentry + PostHog wrappers. Platform-specific init is in the apps; this
// package owns the event taxonomy (analytics event names + payloads) and
// shared log helpers so we don't have stringly-typed events scattered.

export const ANALYTICS_EVENTS = [
  'contact_created',
  'contact_updated',
  'contact_deleted',
  'contact_favorited',
  'contact_promoted',
  'list_created',
  'list_deleted',
  'share_initiated',
  'share_received',
  'theme_changed',
  'subscription_upgraded',
] as const

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number]
