import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('@/lib/current-user', () => ({ requireCurrentUser: vi.fn() }))
vi.mock('@rando/db', () => ({
  getContactById: vi.fn(),
  updateContact: vi.fn(),
}))

import { requireCurrentUser } from '@/lib/current-user'
import { getContactById, updateContact } from '@rando/db'
import { GET, PATCH } from '../route'

const reqUser = vi.mocked(requireCurrentUser)
const byId = vi.mocked(getContactById)
const update = vi.mocked(updateContact)

const FAKE_USER = { id: 'u_1' } as Awaited<ReturnType<typeof requireCurrentUser>>
const ROW = {
  id: 'c_1',
  first_name: 'Jane',
  last_name: 'Smith',
  avatar_kind: 'monogram' as const,
  avatar_value: null,
  favorite: false,
  promoted: false,
  location_id: 'l_1',
  location_name: 'Wilson Park',
  lat: 33.94,
  lng: -118.41,
  meters: 0,
}

const ctx = (id = 'c_1') => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  reqUser.mockResolvedValue(FAKE_USER)
})

describe('GET /v1/contacts/[id]', () => {
  it('returns the mapped ContactListItem when found', async () => {
    byId.mockResolvedValue(ROW)
    const res = await GET(new Request('http://localhost/v1/contacts/c_1?near=33.94,-118.41'), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; location: { name: string } | null }
    expect(body.id).toBe('c_1')
    expect(body.location?.name).toBe('Wilson Park')
    expect(byId).toHaveBeenCalledWith(expect.anything(), 'u_1', 'c_1', {
      lat: 33.94,
      lng: -118.41,
    })
  })

  it('returns 404 when the lookup misses', async () => {
    byId.mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/v1/contacts/c_x'), ctx('c_x'))
    expect(res.status).toBe(404)
  })

  it('passes null `near` when the query param is missing/malformed', async () => {
    byId.mockResolvedValue(ROW)
    await GET(new Request('http://localhost/v1/contacts/c_1'), ctx())
    expect(byId).toHaveBeenCalledWith(expect.anything(), 'u_1', 'c_1', null)
  })
})

describe('PATCH /v1/contacts/[id]', () => {
  function req(body: unknown): Request {
    return new Request('http://localhost/v1/contacts/c_1', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  }

  it('400s when the body is not JSON', async () => {
    const res = await PATCH(
      new Request('http://localhost/v1/contacts/c_1', {
        method: 'PATCH',
        body: 'not json',
      }),
      ctx(),
    )
    expect(res.status).toBe(400)
  })

  it('400s on unknown fields (strict zod)', async () => {
    const res = await PATCH(req({ unknown_field: 'x' }), ctx())
    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('400s on out-of-range string lengths', async () => {
    const res = await PATCH(req({ firstName: '' }), ctx())
    expect(res.status).toBe(400)
  })

  it('updates favorite + returns the freshly-read row', async () => {
    update.mockResolvedValue(1)
    byId.mockResolvedValue({ ...ROW, favorite: true })
    const res = await PATCH(req({ favorite: true }), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { favorite: boolean }
    expect(body.favorite).toBe(true)
    expect(update).toHaveBeenCalledWith(expect.anything(), 'u_1', 'c_1', { favorite: true })
  })

  it('404s when the contact does not exist (update returned 0 + lookup misses)', async () => {
    update.mockResolvedValue(0)
    byId.mockResolvedValue(null)
    const res = await PATCH(req({ favorite: true }), ctx('c_ghost'))
    expect(res.status).toBe(404)
  })

  it('accepts an empty patch as a noop (200 with current row)', async () => {
    update.mockResolvedValue(0)
    byId.mockResolvedValue(ROW)
    const res = await PATCH(req({}), ctx())
    // update returns 0 for an empty patch, but the row exists, so we
    // re-read and return it. Caller sees 200 with the current state.
    expect(res.status).toBe(200)
  })

  it('passes lat/lng through to the post-patch read', async () => {
    update.mockResolvedValue(1)
    byId.mockResolvedValue(ROW)
    await PATCH(
      new Request('http://localhost/v1/contacts/c_1?near=33.94,-118.41', {
        method: 'PATCH',
        body: JSON.stringify({ notes: 'updated' }),
      }),
      ctx(),
    )
    expect(byId).toHaveBeenCalledWith(expect.anything(), 'u_1', 'c_1', {
      lat: 33.94,
      lng: -118.41,
    })
  })
})
