// Tests for the contacts route handler. We mock the three modules the
// handler depends on (db client factory, current-user auth, and the
// @rando/db query helpers) and call the exported GET/POST functions
// directly with synthesized Request objects.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => ({})),
}))
vi.mock('@/lib/current-user', () => ({
  requireCurrentUser: vi.fn(),
}))
vi.mock('@rando/db', () => ({
  getContactsNearby: vi.fn(),
  createContactWithLocation: vi.fn(),
}))

import { requireCurrentUser } from '@/lib/current-user'
import { createContactWithLocation, getContactsNearby } from '@rando/db'
import { GET, POST } from '../route'

const reqUser = vi.mocked(requireCurrentUser)
const listMock = vi.mocked(getContactsNearby)
const createMock = vi.mocked(createContactWithLocation)

const FAKE_USER = { id: 'u_1' } as Awaited<ReturnType<typeof requireCurrentUser>>

beforeEach(() => {
  vi.clearAllMocks()
  reqUser.mockResolvedValue(FAKE_USER)
})

const NEARBY_ROW = {
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
  meters: 12,
}

describe('GET /v1/contacts', () => {
  it('returns mapped ContactListItem rows for the current user', async () => {
    listMock.mockResolvedValue([NEARBY_ROW])
    const res = await GET(new Request('http://localhost/v1/contacts?near=33.94,-118.41'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(body).toEqual([
      {
        id: 'c_1',
        firstName: 'Jane',
        lastName: 'Smith',
        avatarKind: 'monogram',
        avatarValue: null,
        favorite: false,
        promoted: false,
        location: { id: 'l_1', name: 'Wilson Park', lat: 33.94, lng: -118.41, meters: 12 },
      },
    ])
    expect(listMock).toHaveBeenCalledWith(expect.anything(), 'u_1', { lat: 33.94, lng: -118.41 })
  })

  it('passes null `near` when the query string is missing or malformed', async () => {
    listMock.mockResolvedValue([])
    await GET(new Request('http://localhost/v1/contacts'))
    expect(listMock).toHaveBeenCalledWith(expect.anything(), 'u_1', null)

    listMock.mockClear()
    await GET(new Request('http://localhost/v1/contacts?near=not-a-pair'))
    expect(listMock).toHaveBeenCalledWith(expect.anything(), 'u_1', null)
  })

  it('flattens row to `location: null` when the contact has no interaction yet', async () => {
    listMock.mockResolvedValue([
      {
        ...NEARBY_ROW,
        location_id: null,
        location_name: null,
        lat: null,
        lng: null,
        meters: null,
      },
    ])
    const res = await GET(new Request('http://localhost/v1/contacts'))
    const body = (await res.json()) as Array<{ location: unknown }>
    expect(body[0]?.location).toBeNull()
  })
})

describe('POST /v1/contacts', () => {
  function postReq(body: unknown): Request {
    return new Request('http://localhost/v1/contacts', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  }

  it('creates the contact and returns the new row + locationReused flag', async () => {
    createMock.mockResolvedValue({
      contactId: 'c_new',
      locationId: 'l_new',
      locationReused: false,
    })
    listMock.mockResolvedValue([{ ...NEARBY_ROW, id: 'c_new' }])
    const res = await POST(
      postReq({
        firstName: 'Jane',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { contact: { id: string }; locationReused: boolean }
    expect(body.contact.id).toBe('c_new')
    expect(body.locationReused).toBe(false)
    expect(createMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerUserId: 'u_1',
        firstName: 'Jane',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      }),
    )
  })

  it('400s when the body is not JSON', async () => {
    const res = await POST(
      new Request('http://localhost/v1/contacts', {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/JSON/)
  })

  it('400s when zod validation fails (e.g. out-of-range lat)', async () => {
    const res = await POST(
      postReq({
        firstName: 'Jane',
        location: { lat: 999, lng: -118, name: 'Bad' },
      }),
    )
    expect(res.status).toBe(400)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('400s when none of firstName/lastName/company are provided', async () => {
    const res = await POST(
      postReq({
        notes: 'just a placeholder',
        location: { lat: 0, lng: 0, name: 'X' },
      }),
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/firstName/i)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('500s when the post-insert lookup somehow misses the new row', async () => {
    createMock.mockResolvedValue({
      contactId: 'c_ghost',
      locationId: 'l_new',
      locationReused: false,
    })
    listMock.mockResolvedValue([]) // empty — the row we just created isn't here
    const res = await POST(
      postReq({
        firstName: 'Jane',
        location: { lat: 0, lng: 0, name: 'X' },
      }),
    )
    expect(res.status).toBe(500)
  })
})
