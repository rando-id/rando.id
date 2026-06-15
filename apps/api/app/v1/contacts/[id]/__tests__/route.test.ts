// Tests for /v1/contacts/[id] — get + patch via ts-rest. The path
// param flows from the URL itself (the contract declares `:id`), so
// we no longer pass a ctx object — just a NextRequest.

import { NextRequest } from 'next/server'
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

function getReq(url: string): NextRequest {
  return new NextRequest(new Request(url))
}

function patchReq(id: string, body: unknown, query = ''): NextRequest {
  return new NextRequest(
    new Request(`http://localhost/v1/contacts/${id}${query}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  reqUser.mockResolvedValue(FAKE_USER)
})

describe('GET /v1/contacts/[id]', () => {
  it('returns the mapped ContactListItem when found', async () => {
    byId.mockResolvedValue(ROW)
    const res = await GET(getReq('http://localhost/v1/contacts/c_1?near=33.94,-118.41'))
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
    const res = await GET(getReq('http://localhost/v1/contacts/c_x'))
    expect(res.status).toBe(404)
  })

  it('passes null `near` when the query param is missing/malformed', async () => {
    byId.mockResolvedValue(ROW)
    await GET(getReq('http://localhost/v1/contacts/c_1'))
    expect(byId).toHaveBeenCalledWith(expect.anything(), 'u_1', 'c_1', null)
  })
})

describe('PATCH /v1/contacts/[id]', () => {
  it('400s on unknown fields (strict zod)', async () => {
    const res = await PATCH(patchReq('c_1', { unknown_field: 'x' }))
    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('400s on out-of-range string lengths', async () => {
    const res = await PATCH(patchReq('c_1', { firstName: '' }))
    expect(res.status).toBe(400)
  })

  it('updates favorite + returns the freshly-read row', async () => {
    update.mockResolvedValue(1)
    byId.mockResolvedValue({ ...ROW, favorite: true })
    const res = await PATCH(patchReq('c_1', { favorite: true }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { favorite: boolean }
    expect(body.favorite).toBe(true)
    expect(update).toHaveBeenCalledWith(expect.anything(), 'u_1', 'c_1', { favorite: true })
  })

  it('404s when the contact does not exist (update returned 0 + lookup misses)', async () => {
    update.mockResolvedValue(0)
    byId.mockResolvedValue(null)
    const res = await PATCH(patchReq('c_ghost', { favorite: true }))
    expect(res.status).toBe(404)
  })

  it('accepts an empty patch as a noop (200 with current row)', async () => {
    update.mockResolvedValue(0)
    byId.mockResolvedValue(ROW)
    const res = await PATCH(patchReq('c_1', {}))
    expect(res.status).toBe(200)
  })

  it('passes lat/lng through to the post-patch read', async () => {
    update.mockResolvedValue(1)
    byId.mockResolvedValue(ROW)
    await PATCH(patchReq('c_1', { notes: 'updated' }, '?near=33.94,-118.41'))
    expect(byId).toHaveBeenCalledWith(expect.anything(), 'u_1', 'c_1', {
      lat: 33.94,
      lng: -118.41,
    })
  })
})
