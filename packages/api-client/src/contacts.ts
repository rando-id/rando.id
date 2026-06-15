// Public wrappers around the typed ts-rest client for /v1/contacts*.
// The contract owns URL building + header injection + body serialization;
// these wrappers exist only to preserve the call-site shape that
// web/native hooks have used since before the migration:
//
//   const items = await listContacts(client, { lat, lng, q, sort })
//
// The {lat,lng} pair is collapsed into the single `near` query param
// that the contract declares.

import { unwrap, type ApiClient } from './client'

export type AvatarKind = 'photo' | 'gravatar' | 'monogram' | 'emoji' | 'random'

export type ContactListItem = {
  id: string
  firstName: string | null
  lastName: string | null
  avatarKind: AvatarKind
  avatarValue: string | null
  favorite: boolean
  promoted: boolean
  location: {
    id: string
    name: string
    lat: number
    lng: number
    meters: number
  } | null
}

export type ContactSort = 'distance' | 'last_name' | 'date_added' | 'date_updated'

export type ListContactsQuery = {
  lat?: number
  lng?: number
  /** Only return favorited contacts. */
  favorites?: boolean
  /** Only return contacts that are members of this list id. */
  listId?: string
  /** Free-text search; ILIKE substring on first/last/company server-side. */
  q?: string
  /** Sort mode. Server defaults to distance when near is set, else last_name. */
  sort?: ContactSort
}

function nearStr(q: { lat?: number; lng?: number }): string | undefined {
  return q.lat != null && q.lng != null ? `${q.lat},${q.lng}` : undefined
}

export async function listContacts(
  client: ApiClient,
  query: ListContactsQuery = {},
): Promise<ContactListItem[]> {
  const res = await client.tsRest.listContacts({
    query: {
      near: nearStr(query),
      favorites: query.favorites ? 'true' : undefined,
      list: query.listId,
      // Drop empty `q` so we never send `?q=` (matches old behavior).
      q: query.q && query.q.length > 0 ? query.q : undefined,
      sort: query.sort,
    },
  })
  return unwrap(res, '/v1/contacts') as ContactListItem[]
}

export type CreateContactInput = {
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  notes?: string | null
  favorite?: boolean
  location: {
    lat: number
    lng: number
    name: string
    address?: string | null
  }
  interaction?: {
    metAt?: string
    notes?: string | null
  }
}

export type CreateContactResult = {
  contact: ContactListItem
  locationReused: boolean
}

export async function createContact(
  client: ApiClient,
  input: CreateContactInput,
): Promise<CreateContactResult> {
  const res = await client.tsRest.createContact({ body: input })
  return unwrap(res, '/v1/contacts') as CreateContactResult
}

export type GetContactQuery = { lat?: number; lng?: number }

export async function getContact(
  client: ApiClient,
  id: string,
  query: GetContactQuery = {},
): Promise<ContactListItem> {
  const res = await client.tsRest.getContact({
    params: { id },
    query: { near: nearStr(query) },
  })
  return unwrap(res, `/v1/contacts/${id}`) as ContactListItem
}

export type UpdateContactInput = {
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  notes?: string | null
  favorite?: boolean
}

export async function updateContact(
  client: ApiClient,
  id: string,
  patch: UpdateContactInput,
  query: GetContactQuery = {},
): Promise<ContactListItem> {
  const res = await client.tsRest.updateContact({
    params: { id },
    query: { near: nearStr(query) },
    body: patch,
  })
  return unwrap(res, `/v1/contacts/${id}`) as ContactListItem
}
