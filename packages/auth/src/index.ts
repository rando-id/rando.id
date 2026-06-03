export * from './webhooks'

export type RandoUserId = string & { readonly __brand: 'RandoUserId' }
export type ClerkUserId = string & { readonly __brand: 'ClerkUserId' }

export function brandClerkId(id: string): ClerkUserId {
  return id as ClerkUserId
}
