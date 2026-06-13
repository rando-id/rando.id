// Pure helpers extracted from the contact UI so they can be tested
// without spinning up Tamagui + React + jsdom. The components import
// from here; tests do too.

import type { ContactListItem } from '@rando/api-client'

/** Human-friendly display name. Falls back to "Unnamed". */
export function displayName(c: Pick<ContactListItem, 'firstName' | 'lastName'>): string {
  const first = c.firstName?.trim()
  const last = c.lastName?.trim()
  if (first && last) return `${first} ${last}`
  if (first) return first
  if (last) return last
  return 'Unnamed'
}

/** Distance label — meters under 1km, kilometers above. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

export interface NewContactDraft {
  firstName: string
  lastName: string
  locationName: string
}

/**
 * Validate a new-contact draft. Returns the first error message or null
 * if the draft is submittable. Mirrors the server-side rules so the
 * form can fail fast without a network round-trip.
 */
export function validateNewContactDraft(draft: NewContactDraft): string | null {
  if (!draft.firstName.trim() && !draft.lastName.trim()) {
    return 'Add at least a first or last name.'
  }
  if (!draft.locationName.trim()) {
    return 'Give the location a name.'
  }
  return null
}
