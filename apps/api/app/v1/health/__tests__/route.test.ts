// Health route — ts-rest handler under the hood. We pass a real
// NextRequest because @ts-rest/serverless reads the URL and method
// from it via the App Router contract.

import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { GET } from '../route'

describe('GET /v1/health', () => {
  it('returns ok + service identity', async () => {
    const req = new NextRequest(new Request('http://localhost/v1/health'))
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      service: string
      version: string
      timestamp: string
    }
    expect(body.ok).toBe(true)
    expect(body.service).toBe('rando-api')
    expect(body.version).toBe('0.0.0')
    // ISO 8601 timestamp.
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow()
  })
})
