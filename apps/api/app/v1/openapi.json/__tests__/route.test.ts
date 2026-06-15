// Drift gate for the auto-generated OpenAPI spec.
//
// The body assertions catch trivial regressions (status, version,
// paths present). The snapshot is the real gate: any contract change
// that affects the wire shape fails this test until the snapshot is
// updated with `pnpm vitest -u`. Reviewers see exactly what changed
// in the diff, line by line.
//
// IMPORTANT: only run `vitest -u` when the contract change is
// intentional. Otherwise the snapshot has done its job — investigate.

import { describe, expect, it } from 'vitest'
import { GET } from '../route'

describe('GET /v1/openapi.json', () => {
  it('returns a 3.x OpenAPI doc with every contract endpoint', async () => {
    const res = GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      openapi: string
      info: { title: string }
      paths: Record<string, unknown>
    }
    expect(body.openapi).toMatch(/^3\./)
    expect(body.info.title).toBe('Rando API')
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/v1/health',
        '/v1/contacts',
        '/v1/contacts/{id}',
        '/v1/lists',
        '/v1/lists/{id}',
        '/v1/lists/{id}/members',
        '/v1/lists/{id}/members/{contactId}',
      ]),
    )
  })

  it('matches the committed snapshot (drift gate)', async () => {
    const res = GET()
    const body = await res.json()
    expect(body).toMatchSnapshot()
  })
})
