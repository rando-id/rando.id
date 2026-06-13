// `serverApiClient` is a thin wrapper that builds an @rando/api-client
// configured to fetch a Clerk token on each request. These tests verify
// the wiring without booting the real Clerk SDK.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => auth(),
}))

import { serverApiClient } from '../api-client'

beforeEach(() => {
  vi.unstubAllGlobals()
  auth.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('serverApiClient', () => {
  it('uses NEXT_PUBLIC_RANDO_API_URL when set, otherwise localhost:4000', () => {
    vi.stubEnv('NEXT_PUBLIC_RANDO_API_URL', 'https://api.example')
    expect(serverApiClient().baseUrl).toBe('https://api.example')

    vi.unstubAllEnvs()
    expect(serverApiClient().baseUrl).toBe('http://localhost:4000')
  })

  it('threads the Clerk-issued token into outgoing requests', async () => {
    auth.mockResolvedValue({ getToken: () => Promise.resolve('tok_xyz') })
    const captured: Array<Record<string, string>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        captured.push((init?.headers as Record<string, string>) ?? {})
        return new Response('{}', { status: 200 })
      }),
    )
    await serverApiClient().request('/v1/health')
    expect(captured[0]).toMatchObject({ authorization: 'Bearer tok_xyz' })
  })
})
