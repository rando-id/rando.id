// Tests for /v1/lists* route handlers, now backed by ts-rest's
// createNextHandler. Single-arg call signature; path params come from
// the URL path itself.

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('@/lib/current-user', () => ({ requireCurrentUser: vi.fn() }))
vi.mock('@rando/db', () => ({
  listLists: vi.fn(),
  createList: vi.fn(),
  getListById: vi.fn(),
  updateListName: vi.fn(),
  deleteList: vi.fn(),
  addListMember: vi.fn(),
  removeListMember: vi.fn(),
  getContactsNearby: vi.fn(),
}))

import { requireCurrentUser } from '@/lib/current-user'
import {
  addListMember as addListMemberDb,
  createList as createListDb,
  deleteList as deleteListDb,
  getContactsNearby,
  getListById,
  listLists as listListsDb,
  removeListMember as removeListMemberDb,
  updateListName,
} from '@rando/db'
import { GET as listsGET, POST as listsPOST } from '../route'
import { DELETE as listDELETE, GET as listGET, PATCH as listPATCH } from '../[id]/route'
import { POST as memberPOST } from '../[id]/members/route'
import { DELETE as memberDELETE } from '../[id]/members/[contactId]/route'

const reqUser = vi.mocked(requireCurrentUser)
const listLists = vi.mocked(listListsDb)
const createList = vi.mocked(createListDb)
const byId = vi.mocked(getListById)
const updateName = vi.mocked(updateListName)
const deleteList = vi.mocked(deleteListDb)
const addMember = vi.mocked(addListMemberDb)
const removeMember = vi.mocked(removeListMemberDb)
const listContactsForList = vi.mocked(getContactsNearby)

// Route handlers now reject non-UUID path params with 404 (see
// `isUuid` guard added with the security-hardening pass). Fixture IDs
// have to be real UUIDs to clear that guard and reach the mocks.
const U1 = '00000000-0000-4000-8000-000000000001'
const L1 = '00000000-0000-4000-8000-00000000001a'
const C1 = '00000000-0000-4000-8000-00000000000c'
const C2 = '00000000-0000-4000-8000-00000000000d'
const LX = '00000000-0000-4000-8000-fffffffffffe'
const CX = '00000000-0000-4000-8000-ffffffffffff'

const FAKE_USER = { id: U1 } as Awaited<ReturnType<typeof requireCurrentUser>>

const LIST_ROW = {
  id: L1,
  ownerUserId: U1,
  name: 'School pickup',
  kind: 'custom' as const,
  coverImage: null,
  createdAt: new Date('2026-06-13T00:00:00Z'),
  updatedAt: new Date('2026-06-13T00:00:00Z'),
}

function jsonReq(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(
    new Request(url, {
      method,
      ...(body !== undefined
        ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
        : {}),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  reqUser.mockResolvedValue(FAKE_USER)
})

describe('GET /v1/lists', () => {
  it('returns mapped ListItem rows', async () => {
    listLists.mockResolvedValue([{ ...LIST_ROW, memberCount: 3 }])
    const res = await listsGET(new NextRequest(new Request('http://localhost/v1/lists')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ id: string; memberCount: number }>
    expect(body[0]?.id).toBe(L1)
    expect(body[0]?.memberCount).toBe(3)
  })
})

describe('POST /v1/lists', () => {
  it('creates and returns 201', async () => {
    createList.mockResolvedValue({ ...LIST_ROW, memberCount: 0 })
    const res = await listsPOST(jsonReq('http://localhost/v1/lists', 'POST', { name: 'Pickup' }))
    expect(res.status).toBe(201)
    expect(createList).toHaveBeenCalledWith(expect.anything(), U1, 'Pickup')
  })

  it('400s on unknown fields (strict zod)', async () => {
    const res = await listsPOST(
      jsonReq('http://localhost/v1/lists', 'POST', { name: 'X', kind: 'group' }),
    )
    expect(res.status).toBe(400)
    expect(createList).not.toHaveBeenCalled()
  })

  it('400s on missing name', async () => {
    const res = await listsPOST(jsonReq('http://localhost/v1/lists', 'POST', {}))
    expect(res.status).toBe(400)
  })
})

describe('GET /v1/lists/[id]', () => {
  it('returns list + embedded members', async () => {
    byId.mockResolvedValue(LIST_ROW)
    listContactsForList.mockResolvedValue([
      {
        id: C1,
        first_name: 'Jane',
        last_name: 'Smith',
        avatar_kind: 'monogram' as const,
        avatar_value: null,
        favorite: false,
        promoted: false,
        location_id: null,
        location_name: null,
        lat: null,
        lng: null,
        meters: null,
      },
    ])
    const res = await listGET(new NextRequest(new Request(`http://localhost/v1/lists/${L1}`)))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; members: Array<{ id: string }> }
    expect(body.id).toBe(L1)
    expect(body.members).toHaveLength(1)
    expect(body.members[0]?.id).toBe(C1)
    expect(listContactsForList).toHaveBeenCalledWith(expect.anything(), U1, null, {
      listId: L1,
    })
  })

  it('returns 404 when the list does not exist', async () => {
    byId.mockResolvedValue(null)
    const res = await listGET(new NextRequest(new Request(`http://localhost/v1/lists/${LX}`)))
    expect(res.status).toBe(404)
  })
})

describe('PATCH /v1/lists/[id]', () => {
  it('renames and returns the updated list', async () => {
    updateName.mockResolvedValue(1)
    byId.mockResolvedValue({ ...LIST_ROW, name: 'Pickup' })
    const res = await listPATCH(
      jsonReq(`http://localhost/v1/lists/${L1}`, 'PATCH', { name: 'Pickup' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string }
    expect(body.name).toBe('Pickup')
    expect(updateName).toHaveBeenCalledWith(expect.anything(), U1, L1, 'Pickup')
  })

  it('404s when update affects 0 rows', async () => {
    updateName.mockResolvedValue(0)
    const res = await listPATCH(
      jsonReq(`http://localhost/v1/lists/${LX}`, 'PATCH', { name: 'Pickup' }),
    )
    expect(res.status).toBe(404)
  })

  it('400s on unknown fields', async () => {
    const res = await listPATCH(
      jsonReq(`http://localhost/v1/lists/${L1}`, 'PATCH', { name: 'P', kind: 'group' }),
    )
    expect(res.status).toBe(400)
  })
})

describe('DELETE /v1/lists/[id]', () => {
  it('deletes when affected > 0', async () => {
    deleteList.mockResolvedValue(1)
    const res = await listDELETE(
      new NextRequest(new Request(`http://localhost/v1/lists/${L1}`, { method: 'DELETE' })),
    )
    expect(res.status).toBe(200)
  })

  it('404s when affected = 0', async () => {
    deleteList.mockResolvedValue(0)
    const res = await listDELETE(
      new NextRequest(new Request(`http://localhost/v1/lists/${LX}`, { method: 'DELETE' })),
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /v1/lists/[id]/members', () => {
  it('passes added=true through on a fresh add', async () => {
    addMember.mockResolvedValue(true)
    const res = await memberPOST(
      jsonReq(`http://localhost/v1/lists/${L1}/members`, 'POST', {
        contactId: C1,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; added: boolean }
    expect(body.added).toBe(true)
  })

  it('passes added=false through on an idempotent re-add', async () => {
    addMember.mockResolvedValue(false)
    const res = await memberPOST(
      jsonReq(`http://localhost/v1/lists/${L1}/members`, 'POST', {
        contactId: C1,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; added: boolean }
    expect(body.added).toBe(false)
  })

  it('400s on a non-UUID contactId', async () => {
    const res = await memberPOST(
      jsonReq(`http://localhost/v1/lists/${L1}/members`, 'POST', { contactId: 'not-a-uuid' }),
    )
    expect(res.status).toBe(400)
    expect(addMember).not.toHaveBeenCalled()
  })
})

describe('DELETE /v1/lists/[id]/members/[contactId]', () => {
  it('removes when affected > 0', async () => {
    removeMember.mockResolvedValue(1)
    const res = await memberDELETE(
      new NextRequest(
        new Request(`http://localhost/v1/lists/${L1}/members/${C2}`, { method: 'DELETE' }),
      ),
    )
    expect(res.status).toBe(200)
  })

  it('404s when affected = 0', async () => {
    removeMember.mockResolvedValue(0)
    const res = await memberDELETE(
      new NextRequest(
        new Request(`http://localhost/v1/lists/${L1}/members/${CX}`, { method: 'DELETE' }),
      ),
    )
    expect(res.status).toBe(404)
  })
})

describe('unauthorized branches', () => {
  // Every route catches the Response thrown by requireCurrentUser and
  // maps it to an env-appropriate status. Exercise each here so the
  // catch arms aren't dead coverage.
  beforeEach(() => {
    reqUser.mockRejectedValue(new Response('Unauthorized', { status: 401 }))
  })

  it('GET /v1/lists returns 200 with []', async () => {
    const res = await listsGET(new NextRequest(new Request('http://localhost/v1/lists')))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('POST /v1/lists returns 400', async () => {
    const res = await listsPOST(jsonReq('http://localhost/v1/lists', 'POST', { name: 'X' }))
    expect(res.status).toBe(400)
  })

  it('GET /v1/lists/[id] returns 404', async () => {
    const res = await listGET(new NextRequest(new Request(`http://localhost/v1/lists/${L1}`)))
    expect(res.status).toBe(404)
  })

  it('PATCH /v1/lists/[id] returns 404', async () => {
    const res = await listPATCH(jsonReq(`http://localhost/v1/lists/${L1}`, 'PATCH', { name: 'X' }))
    expect(res.status).toBe(404)
  })

  it('DELETE /v1/lists/[id] returns 404', async () => {
    const res = await listDELETE(
      new NextRequest(new Request(`http://localhost/v1/lists/${L1}`, { method: 'DELETE' })),
    )
    expect(res.status).toBe(404)
  })

  it('POST /v1/lists/[id]/members returns 400', async () => {
    const res = await memberPOST(
      jsonReq(`http://localhost/v1/lists/${L1}/members`, 'POST', {
        contactId: C1,
      }),
    )
    expect(res.status).toBe(400)
  })

  it('DELETE /v1/lists/[id]/members/[contactId] returns 404', async () => {
    const res = await memberDELETE(
      new NextRequest(
        new Request(`http://localhost/v1/lists/${L1}/members/${C2}`, { method: 'DELETE' }),
      ),
    )
    expect(res.status).toBe(404)
  })
})
