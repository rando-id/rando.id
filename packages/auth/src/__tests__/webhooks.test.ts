import { describe, expect, it } from 'vitest'
import {
  clerkWebhookSchema,
  clerkUserCreatedSchema,
  clerkUserUpdatedSchema,
  clerkUserDeletedSchema,
  displayNameFromClerk,
  primaryEmailFromClerk,
} from '../webhooks'

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('clerkUserCreatedSchema', () => {
  it('accepts a valid user.created payload', () => {
    const result = clerkUserCreatedSchema.safeParse({
      type: 'user.created',
      data: {
        id: 'user_abc',
        first_name: 'Jane',
        last_name: 'Doe',
        image_url: 'https://img.clerk.com/abc',
        email_addresses: [{ id: 'ea_1', email_address: 'jane@example.com' }],
        primary_email_address_id: 'ea_1',
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a payload with wrong type literal', () => {
    const result = clerkUserCreatedSchema.safeParse({
      type: 'user.updated',
      data: { id: 'user_abc' },
    })
    expect(result.success).toBe(false)
  })

  it('defaults email_addresses to empty array when missing', () => {
    const result = clerkUserCreatedSchema.safeParse({
      type: 'user.created',
      data: { id: 'user_abc' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.data.email_addresses).toEqual([])
    }
  })
})

describe('clerkUserUpdatedSchema', () => {
  it('accepts a valid user.updated payload', () => {
    const result = clerkUserUpdatedSchema.safeParse({
      type: 'user.updated',
      data: {
        id: 'user_abc',
        first_name: 'Jane',
        last_name: null,
        email_addresses: [],
      },
    })
    expect(result.success).toBe(true)
  })
})

describe('clerkUserDeletedSchema', () => {
  it('accepts a valid user.deleted payload', () => {
    const result = clerkUserDeletedSchema.safeParse({
      type: 'user.deleted',
      data: { id: 'user_abc', deleted: true },
    })
    expect(result.success).toBe(true)
  })

  it('accepts user.deleted without the deleted flag', () => {
    const result = clerkUserDeletedSchema.safeParse({
      type: 'user.deleted',
      data: { id: 'user_abc' },
    })
    expect(result.success).toBe(true)
  })
})

describe('clerkWebhookSchema (discriminated union)', () => {
  it('routes user.created to the correct branch', () => {
    const result = clerkWebhookSchema.safeParse({
      type: 'user.created',
      data: { id: 'user_abc' },
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.type).toBe('user.created')
  })

  it('routes user.updated to the correct branch', () => {
    const result = clerkWebhookSchema.safeParse({
      type: 'user.updated',
      data: { id: 'user_abc' },
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.type).toBe('user.updated')
  })

  it('routes user.deleted to the correct branch', () => {
    const result = clerkWebhookSchema.safeParse({
      type: 'user.deleted',
      data: { id: 'user_abc' },
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.type).toBe('user.deleted')
  })

  it('rejects an unknown event type', () => {
    const result = clerkWebhookSchema.safeParse({
      type: 'session.ended',
      data: { id: 'sess_abc' },
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// displayNameFromClerk
// ---------------------------------------------------------------------------

describe('displayNameFromClerk', () => {
  it('returns "First Last" when both names exist', () => {
    expect(
      displayNameFromClerk({
        id: 'u',
        first_name: 'Jane',
        last_name: 'Doe',
        email_addresses: [],
      }),
    ).toBe('Jane Doe')
  })

  it('returns first name only when last name is null', () => {
    expect(
      displayNameFromClerk({
        id: 'u',
        first_name: 'Jane',
        last_name: null,
        email_addresses: [],
      }),
    ).toBe('Jane')
  })

  it('returns last name only when first name is null', () => {
    expect(
      displayNameFromClerk({
        id: 'u',
        first_name: null,
        last_name: 'Doe',
        email_addresses: [],
      }),
    ).toBe('Doe')
  })

  it('falls back to email when both names are null', () => {
    expect(
      displayNameFromClerk({
        id: 'u',
        first_name: null,
        last_name: null,
        email_addresses: [{ id: 'ea_1', email_address: 'jane@example.com' }],
      }),
    ).toBe('jane@example.com')
  })

  it('returns "Unnamed" when names are null and no emails exist', () => {
    expect(
      displayNameFromClerk({
        id: 'u',
        first_name: null,
        last_name: null,
        email_addresses: [],
      }),
    ).toBe('Unnamed')
  })

  it('trims whitespace from names', () => {
    expect(
      displayNameFromClerk({
        id: 'u',
        first_name: '  Jane  ',
        last_name: '  Doe  ',
        email_addresses: [],
      }),
    ).toBe('Jane Doe')
  })

  it('treats whitespace-only names as empty', () => {
    expect(
      displayNameFromClerk({
        id: 'u',
        first_name: '   ',
        last_name: '   ',
        email_addresses: [{ id: 'ea_1', email_address: 'a@b.com' }],
      }),
    ).toBe('a@b.com')
  })
})

// ---------------------------------------------------------------------------
// primaryEmailFromClerk
// ---------------------------------------------------------------------------

describe('primaryEmailFromClerk', () => {
  it('returns the email matching primary_email_address_id', () => {
    expect(
      primaryEmailFromClerk({
        id: 'u',
        primary_email_address_id: 'ea_2',
        email_addresses: [
          { id: 'ea_1', email_address: 'a@a.com' },
          { id: 'ea_2', email_address: 'b@b.com' },
        ],
      }),
    ).toBe('b@b.com')
  })

  it('falls back to the first email when primary id does not match', () => {
    expect(
      primaryEmailFromClerk({
        id: 'u',
        primary_email_address_id: 'ea_missing',
        email_addresses: [{ id: 'ea_1', email_address: 'a@a.com' }],
      }),
    ).toBe('a@a.com')
  })

  it('falls back to the first email when primary id is null', () => {
    expect(
      primaryEmailFromClerk({
        id: 'u',
        primary_email_address_id: null,
        email_addresses: [{ id: 'ea_1', email_address: 'a@a.com' }],
      }),
    ).toBe('a@a.com')
  })

  it('returns null when there are no emails and no primary id', () => {
    expect(
      primaryEmailFromClerk({
        id: 'u',
        email_addresses: [],
      }),
    ).toBeNull()
  })
})
