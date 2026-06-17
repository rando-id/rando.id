// Tests for @rando/api-client/client.ts — focused on the response
// parsing branches the per-endpoint tests don't exercise (the
// non-JSON fallback + the empty-body path).
//
// All routes share the same `api:` callback inside createApiClient,
// so testing one route (health is the simplest) covers the parsing
// logic for every route.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../client'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createApiClient — response parsing', () => {
  it('falls back to raw text when the response body is non-JSON', async () => {
    // Some upstreams (CDN error pages, load balancer 5xx, gateway
    // timeouts) emit HTML despite a 2xx status. JSON.parse would
    // throw — the client should hand the raw text back instead.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>oops</html>', { status: 200 })),
    )
    const client = createApiClient({ baseUrl: 'https://api.test' })
    const res = await client.tsRest.health()
    expect(res.status).toBe(200)
    expect(res.body).toBe('<html>oops</html>')
  })

  it('leaves body undefined when the response has no content', async () => {
    // 204 must have a null body per the Fetch spec — pass null to the
    // Response constructor explicitly.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    const client = createApiClient({ baseUrl: 'https://api.test' })
    const res = await client.tsRest.health()
    expect(res.status).toBe(204)
    expect(res.body).toBeUndefined()
  })

  it('attaches the Authorization header when getToken returns a token', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ok: true,
            service: 'api',
            version: '0.0.0',
            timestamp: '2026-06-17T00:00:00Z',
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => 'tok_abc',
    })
    await client.tsRest.health()
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers.authorization).toBe('Bearer tok_abc')
    expect(headers['content-type']).toBe('application/json')
  })
})

describe('createApiClient — request() escape hatch', () => {
  it('returns the parsed JSON body on 2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    )
    const client = createApiClient({ baseUrl: 'https://api.test' })
    const out = await client.request<{ ok: boolean }>('/v1/health')
    expect(out).toEqual({ ok: true })
  })

  it('throws ApiError on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    )
    const client = createApiClient({ baseUrl: 'https://api.test' })
    await expect(client.request('/v1/contacts')).rejects.toBeInstanceOf(ApiError)
  })

  it('throws ApiError with a clipped preview when the 2xx body is non-JSON', async () => {
    // A CDN edge or load balancer can return HTML on a 200 — JSON.parse
    // would throw a generic SyntaxError otherwise; ApiError gives the
    // caller the path + a slice of the body to debug from.
    const html = '<html><body>upstream timed out</body></html>'.repeat(20)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html, { status: 200 })),
    )
    const client = createApiClient({ baseUrl: 'https://api.test' })
    await expect(client.request('/v1/health')).rejects.toMatchObject({
      name: 'Error',
      status: 200,
      path: '/v1/health',
      message: expect.stringContaining('Expected JSON response'),
    })
  })

  it('merges caller-supplied headers with defaults', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({}), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => 'tok_xyz',
    })
    await client.request('/v1/lists', {
      method: 'POST',
      headers: { 'x-custom': 'yes' },
    })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
    expect(headers.authorization).toBe('Bearer tok_xyz')
    expect(headers['x-custom']).toBe('yes')
  })
})
