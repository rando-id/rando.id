import { describe, expect, it } from 'vitest'
import { GET } from '../route'

describe('GET /v1/openapi.json', () => {
  it('returns an OpenAPI 3.1 spec with the health path', async () => {
    const res = GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      openapi: string
      info: { title: string; version: string }
      paths: Record<string, unknown>
    }
    expect(body.openapi).toBe('3.1.0')
    expect(body.info.title).toBe('Rando API')
    expect(body.paths).toHaveProperty('/v1/health')
  })
})
