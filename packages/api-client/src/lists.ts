// Public wrappers around the typed ts-rest client for /v1/lists*.
// Same shape as contacts.ts — the contract owns URL/header/encoding,
// these functions just adapt call-site args to the ts-rest shape.

import { unwrap, type ApiClient } from './client'
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

export type GetListQuery = { lat?: number; lng?: number }

function nearStr(q: { lat?: number; lng?: number }): string | undefined {
  return q.lat != null && q.lng != null ? `${q.lat},${q.lng}` : undefined
}

export async function listLists(client: ApiClient): Promise<ListItem[]> {
  const res = await client.tsRest.listLists()
  return unwrap(res, '/v1/lists') as ListItem[]
}

export async function createList(client: ApiClient, name: string): Promise<ListItem> {
  const res = await client.tsRest.createList({ body: { name } })
  return unwrap(res, '/v1/lists') as ListItem
}

export async function getList(
  client: ApiClient,
  id: string,
  query: GetListQuery = {},
): Promise<ListWithMembers> {
  const res = await client.tsRest.getList({
    params: { id },
    query: { near: nearStr(query) },
  })
  return unwrap(res, `/v1/lists/${id}`) as ListWithMembers
}

export async function updateList(
  client: ApiClient,
  id: string,
  patch: { name: string },
): Promise<ListItem> {
  const res = await client.tsRest.updateList({
    params: { id },
    body: patch,
  })
  return unwrap(res, `/v1/lists/${id}`) as ListItem
}

export async function deleteList(client: ApiClient, id: string): Promise<{ ok: true }> {
  const res = await client.tsRest.deleteList({ params: { id }, body: undefined })
  return unwrap(res, `/v1/lists/${id}`) as { ok: true }
}

export async function addListMember(
  client: ApiClient,
  listId: string,
  contactId: string,
): Promise<{ ok: true; added: boolean }> {
  const res = await client.tsRest.addListMember({
    params: { id: listId },
    body: { contactId },
  })
  return unwrap(res, `/v1/lists/${listId}/members`) as { ok: true; added: boolean }
}

export async function removeListMember(
  client: ApiClient,
  listId: string,
  contactId: string,
): Promise<{ ok: true }> {
  const res = await client.tsRest.removeListMember({
    params: { id: listId, contactId },
    body: undefined,
  })
  return unwrap(res, `/v1/lists/${listId}/members/${contactId}`) as { ok: true }
}
