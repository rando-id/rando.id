// `useApiClient` builds an authenticated api client whose `getToken` is
// wired to Clerk's `useAuth`. Verified by stubbing `useAuth` and
// invoking the resulting client.

import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const useAuth = vi.fn()
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => useAuth(),
}))

import { useApiClient } from '../client-api'

describe('useApiClient', () => {
  it('returns a client whose getToken proxies through useAuth', async () => {
    const getToken = vi.fn().mockResolvedValue('tok_abc')
    useAuth.mockReturnValue({ getToken })

    const { result } = renderHook(() => useApiClient())
    const captured: Array<Record<string, string>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        captured.push((init?.headers as Record<string, string>) ?? {})
        return new Response('{}', { status: 200 })
      }),
    )
    await result.current.request('/v1/health')
    expect(getToken).toHaveBeenCalled()
    expect(captured[0]).toMatchObject({ authorization: 'Bearer tok_abc' })
    vi.unstubAllGlobals()
  })

  it('memoizes the client between renders with the same getToken reference', () => {
    const getToken = vi.fn()
    useAuth.mockReturnValue({ getToken })
    const { result, rerender } = renderHook(() => useApiClient())
    const a = result.current
    rerender()
    expect(result.current).toBe(a)
  })
})
