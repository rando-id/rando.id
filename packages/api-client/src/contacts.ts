import type { ApiClient } from './client'

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

export type ListContactsQuery = {
  lat?: number
  lng?: number
  /** Only return favorited contacts. */
  favorites?: boolean
  /** Only return contacts that are members of this list id. */
  listId?: string
}

export async function listContacts(
  client: ApiClient,
  query: ListContactsQuery = {},
): Promise<ContactListItem[]> {
  const params = new URLSearchParams()
  if (query.lat != null && query.lng != null) {
    params.set('near', `${query.lat},${query.lng}`)
  }
  if (query.favorites) params.set('favorites', 'true')
  if (query.listId) params.set('list', query.listId)
  const path = params.toString() ? `/v1/contacts?${params}` : '/v1/contacts'
  return client.request<ContactListItem[]>(path)
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
    metAt?: string // ISO timestamp
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
  return client.request<CreateContactResult>('/v1/contacts', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export type GetContactQuery = { lat?: number; lng?: number }

export async function getContact(
  client: ApiClient,
  id: string,
  query: GetContactQuery = {},
): Promise<ContactListItem> {
  const params = new URLSearchParams()
  if (query.lat != null && query.lng != null) {
    params.set('near', `${query.lat},${query.lng}`)
  }
  const path = params.toString()
    ? `/v1/contacts/${encodeURIComponent(id)}?${params}`
    : `/v1/contacts/${encodeURIComponent(id)}`
  return client.request<ContactListItem>(path)
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
  const params = new URLSearchParams()
  if (query.lat != null && query.lng != null) {
    params.set('near', `${query.lat},${query.lng}`)
  }
  const path = params.toString()
    ? `/v1/contacts/${encodeURIComponent(id)}?${params}`
    : `/v1/contacts/${encodeURIComponent(id)}`
  return client.request<ContactListItem>(path, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}
