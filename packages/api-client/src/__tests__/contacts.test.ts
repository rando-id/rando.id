// Tests for the @rando/api-client surface. These verify the HTTP shape
// (path, method, headers, body) without spinning up a real server —
// everything goes through a stubbed `fetch`.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../client'
import { createContact, listContacts } from '../contacts'

afterEach(() => {
  vi.restoreAllMocks()
})

interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

function stub(responses: Array<{ status?: number; body?: unknown }>): RecordedCall[] {
  const calls: RecordedCall[] = []
  let i = 0
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const rawBody = typeof init?.body === 'string' ? safeJson(init.body) : (init?.body ?? null)
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: (init?.headers as Record<string, string>) ?? {},
      body: rawBody,
    })
    const r = responses[i++] ?? { status: 200, body: {} }
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 })
  })
  vi.stubGlobal('fetch', f)
  return calls
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

const client = (token?: string) =>
  createApiClient({ baseUrl: 'https://api.test', getToken: token ? async () => token : undefined })

describe('createApiClient + ApiError', () => {
  it('attaches the bearer token from getToken to outgoing requests', async () => {
    const calls = stub([{ body: { ok: true } }])
    await client('tok_abc').request('/v1/health')
    expect(calls[0]?.headers).toMatchObject({ authorization: 'Bearer tok_abc' })
  })

  it('omits authorization header when getToken is undefined', async () => {
    const calls = stub([{ body: {} }])
    await client().request('/v1/health')
    expect(calls[0]?.headers.authorization).toBeUndefined()
  })

  it('throws ApiError on non-2xx with status, path, and body baked in', async () => {
    stub([{ status: 401, body: { error: 'unauthorized' } }])
    await expect(client().request('/v1/contacts')).rejects.toBeInstanceOf(ApiError)
  })

  it('includes content-type: application/json by default', async () => {
    const calls = stub([{ body: {} }])
    await client().request('/v1/health')
    expect(calls[0]?.headers).toMatchObject({ 'content-type': 'application/json' })
  })
})

describe('listContacts', () => {
  it('hits /v1/contacts with no query when lat/lng are missing', async () => {
    const calls = stub([{ body: [] }])
    await listContacts(client())
    expect(calls[0]?.url).toBe('https://api.test/v1/contacts')
  })

  it('passes lat/lng as a `near` query parameter', async () => {
    const calls = stub([{ body: [] }])
    await listContacts(client(), { lat: 33.94, lng: -118.41 })
    expect(calls[0]?.url).toBe('https://api.test/v1/contacts?near=33.94%2C-118.41')
  })

  it('returns the parsed JSON body', async () => {
    stub([
      {
        body: [
          {
            id: 'c_1',
            firstName: 'Jane',
            lastName: null,
            avatarKind: 'monogram',
            avatarValue: null,
            favorite: false,
            promoted: false,
            location: null,
          },
        ],
      },
    ])
    const result = await listContacts(client())
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('c_1')
  })
})

describe('createContact', () => {
  it('POSTs to /v1/contacts with the input as the JSON body', async () => {
    const calls = stub([
      {
        status: 201,
        body: {
          contact: {
            id: 'c_new',
            firstName: 'Jane',
            lastName: null,
            avatarKind: 'monogram',
            avatarValue: null,
            favorite: false,
            promoted: false,
            location: null,
          },
          locationReused: false,
        },
      },
    ])
    const out = await createContact(client('tok'), {
      firstName: 'Jane',
      location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
    })
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe('https://api.test/v1/contacts')
    expect(calls[0]?.body).toEqual({
      firstName: 'Jane',
      location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
    })
    expect(out.contact.id).toBe('c_new')
    expect(out.locationReused).toBe(false)
  })

  it('surfaces server validation errors as ApiError', async () => {
    stub([{ status: 400, body: { error: 'validation failed' } }])
    await expect(
      createContact(client(), {
        firstName: 'Jane',
        location: { lat: 999, lng: 0, name: 'X' },
      }),
    ).rejects.toBeInstanceOf(ApiError)
  })
})
