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
}

export async function listContacts(
  client: ApiClient,
  query: ListContactsQuery = {},
): Promise<ContactListItem[]> {
  const params = new URLSearchParams()
  if (query.lat != null && query.lng != null) {
    params.set('near', `${query.lat},${query.lng}`)
  }
  const path = params.toString() ? `/v1/contacts?${params}` : '/v1/contacts'
  return client.request<ContactListItem[]>(path)
}
