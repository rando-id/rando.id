import type { ApiClient } from './client'
import type { ContactListItem } from './contacts'

export type ListKind = 'custom' | 'location' | 'group' | 'favorites' | 'promoted'

export type ListItem = {
  id: string
  name: string
  kind: ListKind
  coverImage: string | null
  createdAt: string
  updatedAt: string
  memberCount: number
}

export type ListWithMembers = ListItem & {
  members: ContactListItem[]
}

export async function listLists(client: ApiClient): Promise<ListItem[]> {
  return client.request<ListItem[]>('/v1/lists')
}

export async function createList(client: ApiClient, name: string): Promise<ListItem> {
  return client.request<ListItem>('/v1/lists', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export type GetListQuery = { lat?: number; lng?: number }

export async function getList(
  client: ApiClient,
  id: string,
  query: GetListQuery = {},
): Promise<ListWithMembers> {
  const params = new URLSearchParams()
  if (query.lat != null && query.lng != null) {
    params.set('near', `${query.lat},${query.lng}`)
  }
  const path = params.toString()
    ? `/v1/lists/${encodeURIComponent(id)}?${params}`
    : `/v1/lists/${encodeURIComponent(id)}`
  return client.request<ListWithMembers>(path)
}

export async function updateList(
  client: ApiClient,
  id: string,
  patch: { name: string },
): Promise<ListItem> {
  return client.request<ListItem>(`/v1/lists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function deleteList(client: ApiClient, id: string): Promise<{ ok: true }> {
  return client.request<{ ok: true }>(`/v1/lists/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function addListMember(
  client: ApiClient,
  listId: string,
  contactId: string,
): Promise<{ ok: true; added: boolean }> {
  return client.request<{ ok: true; added: boolean }>(
    `/v1/lists/${encodeURIComponent(listId)}/members`,
    {
      method: 'POST',
      body: JSON.stringify({ contactId }),
    },
  )
}

export async function removeListMember(
  client: ApiClient,
  listId: string,
  contactId: string,
): Promise<{ ok: true }> {
  return client.request<{ ok: true }>(
    `/v1/lists/${encodeURIComponent(listId)}/members/${encodeURIComponent(contactId)}`,
    { method: 'DELETE' },
  )
}
