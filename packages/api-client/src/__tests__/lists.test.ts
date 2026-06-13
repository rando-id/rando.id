// Tests for @rando/api-client/lists.ts. Same pattern as contacts.test.ts —
// stubbed fetch, assert HTTP shape (method, path, body) per function.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../client'
import {
  addListMember,
  createList,
  deleteList,
  getList,
  listLists,
  removeListMember,
  updateList,
} from '../lists'

afterEach(() => {
  vi.restoreAllMocks()
})

interface RecordedCall {
  url: string
  method: string
  body: unknown
}

function stub(responses: Array<{ status?: number; body?: unknown }>): RecordedCall[] {
  const calls: RecordedCall[] = []
  let i = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const rawBody = typeof init?.body === 'string' ? safeJson(init.body) : (init?.body ?? null)
      calls.push({
        url,
        method: (init?.method ?? 'GET').toUpperCase(),
        body: rawBody,
      })
      const r = responses[i++] ?? { status: 200, body: {} }
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 })
    }),
  )
  return calls
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

const client = createApiClient({ baseUrl: 'https://api.test' })

const LIST = {
  id: 'l_1',
  name: 'School pickup',
  kind: 'custom' as const,
  coverImage: null,
  createdAt: '2026-06-13T00:00:00Z',
  updatedAt: '2026-06-13T00:00:00Z',
  memberCount: 0,
}

describe('listLists', () => {
  it('GETs /v1/lists', async () => {
    const calls = stub([{ body: [LIST] }])
    const out = await listLists(client)
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url).toBe('https://api.test/v1/lists')
    expect(out).toEqual([LIST])
  })
})

describe('createList', () => {
  it('POSTs /v1/lists with the name', async () => {
    const calls = stub([{ status: 201, body: LIST }])
    const out = await createList(client, 'School pickup')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe('https://api.test/v1/lists')
    expect(calls[0]?.body).toEqual({ name: 'School pickup' })
    expect(out.id).toBe('l_1')
  })

  it('surfaces validation errors as ApiError', async () => {
    stub([{ status: 400, body: { error: 'validation failed' } }])
    await expect(createList(client, '')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('getList', () => {
  it('GETs /v1/lists/<id>', async () => {
    const calls = stub([{ body: { ...LIST, members: [] } }])
    await getList(client, 'l_1')
    expect(calls[0]?.url).toBe('https://api.test/v1/lists/l_1')
  })

  it('passes lat/lng as ?near', async () => {
    const calls = stub([{ body: { ...LIST, members: [] } }])
    await getList(client, 'l_1', { lat: 33.94, lng: -118.41 })
    expect(calls[0]?.url).toBe('https://api.test/v1/lists/l_1?near=33.94%2C-118.41')
  })
})

describe('updateList', () => {
  it('PATCHes with the new name', async () => {
    const calls = stub([{ body: { ...LIST, name: 'Pickup' } }])
    await updateList(client, 'l_1', { name: 'Pickup' })
    expect(calls[0]?.method).toBe('PATCH')
    expect(calls[0]?.url).toBe('https://api.test/v1/lists/l_1')
    expect(calls[0]?.body).toEqual({ name: 'Pickup' })
  })
})

describe('deleteList', () => {
  it('DELETEs /v1/lists/<id>', async () => {
    const calls = stub([{ body: { ok: true } }])
    await deleteList(client, 'l_1')
    expect(calls[0]?.method).toBe('DELETE')
    expect(calls[0]?.url).toBe('https://api.test/v1/lists/l_1')
  })
})

describe('addListMember', () => {
  it('POSTs the contactId to /v1/lists/<id>/members', async () => {
    const calls = stub([{ status: 200, body: { ok: true, added: true } }])
    const out = await addListMember(client, 'l_1', 'c_2')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe('https://api.test/v1/lists/l_1/members')
    expect(calls[0]?.body).toEqual({ contactId: 'c_2' })
    expect(out).toEqual({ ok: true, added: true })
  })
})

describe('removeListMember', () => {
  it('DELETEs /v1/lists/<id>/members/<contactId>', async () => {
    const calls = stub([{ body: { ok: true } }])
    await removeListMember(client, 'l_1', 'c_2')
    expect(calls[0]?.method).toBe('DELETE')
    expect(calls[0]?.url).toBe('https://api.test/v1/lists/l_1/members/c_2')
  })
})
