import { z } from 'zod'

const emailAddressSchema = z.object({
  id: z.string(),
  email_address: z.string().email(),
})

const userPayloadSchema = z.object({
  id: z.string(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  email_addresses: z.array(emailAddressSchema).default([]),
  primary_email_address_id: z.string().nullable().optional(),
})

export const clerkUserCreatedSchema = z.object({
  type: z.literal('user.created'),
  data: userPayloadSchema,
})

export const clerkUserUpdatedSchema = z.object({
  type: z.literal('user.updated'),
  data: userPayloadSchema,
})

export const clerkUserDeletedSchema = z.object({
  type: z.literal('user.deleted'),
  data: z.object({
    id: z.string(),
    deleted: z.literal(true).optional(),
  }),
})

export const clerkWebhookSchema = z.discriminatedUnion('type', [
  clerkUserCreatedSchema,
  clerkUserUpdatedSchema,
  clerkUserDeletedSchema,
])

export type ClerkWebhook = z.infer<typeof clerkWebhookSchema>
export type ClerkUserPayload = z.infer<typeof userPayloadSchema>

export function displayNameFromClerk(user: ClerkUserPayload): string {
  const first = user.first_name?.trim()
  const last = user.last_name?.trim()
  if (first && last) return `${first} ${last}`
  if (first) return first
  if (last) return last
  return user.email_addresses[0]?.email_address ?? 'Unnamed'
}

export function primaryEmailFromClerk(user: ClerkUserPayload): string | null {
  const primaryId = user.primary_email_address_id
  if (primaryId) {
    const match = user.email_addresses.find((e) => e.id === primaryId)
    if (match) return match.email_address
  }
  return user.email_addresses[0]?.email_address ?? null
}
