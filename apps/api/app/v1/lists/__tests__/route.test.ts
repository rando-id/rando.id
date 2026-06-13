// Tests for /v1/lists* route handlers. Same mocking pattern as the
// contacts routes — vi.mock the three boundaries (db client, auth,
// @rando/db query helpers) and call exported handlers directly.

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

const FAKE_USER = { id: 'u_1' } as Awaited<ReturnType<typeof requireCurrentUser>>

const LIST_ROW = {
  id: 'l_1',
  ownerUserId: 'u_1',
  name: 'School pickup',
  kind: 'custom' as const,
  coverImage: null,
  createdAt: new Date('2026-06-13T00:00:00Z'),
  updatedAt: new Date('2026-06-13T00:00:00Z'),
}

const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  reqUser.mockResolvedValue(FAKE_USER)
})

describe('GET /v1/lists', () => {
  it('returns mapped ListItem rows', async () => {
    listLists.mockResolvedValue([{ ...LIST_ROW, memberCount: 3 }])
    const res = await listsGET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ id: string; memberCount: number }>
    expect(body[0]?.id).toBe('l_1')
    expect(body[0]?.memberCount).toBe(3)
  })
})

describe('POST /v1/lists', () => {
  function req(body: unknown): Request {
    return new Request('http://localhost/v1/lists', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  it('creates and returns 201', async () => {
    createList.mockResolvedValue({ ...LIST_ROW, memberCount: 0 })
    const res = await listsPOST(req({ name: 'Pickup' }))
    expect(res.status).toBe(201)
    expect(createList).toHaveBeenCalledWith(expect.anything(), 'u_1', 'Pickup')
  })

  it('400s on unknown fields (strict zod)', async () => {
    const res = await listsPOST(req({ name: 'X', kind: 'group' }))
    expect(res.status).toBe(400)
    expect(createList).not.toHaveBeenCalled()
  })

  it('400s on invalid JSON', async () => {
    const res = await listsPOST(
      new Request('http://localhost/v1/lists', { method: 'POST', body: 'nope' }),
    )
    expect(res.status).toBe(400)
  })

  it('400s on missing name', async () => {
    const res = await listsPOST(req({}))
    expect(res.status).toBe(400)
  })
})

describe('GET /v1/lists/[id]', () => {
  it('returns list + embedded members', async () => {
    byId.mockResolvedValue(LIST_ROW)
    listContactsForList.mockResolvedValue([
      {
        id: 'c_1',
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
    const res = await listGET(new Request('http://localhost/v1/lists/l_1'), ctx({ id: 'l_1' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; members: Array<{ id: string }> }
    expect(body.id).toBe('l_1')
    expect(body.members).toHaveLength(1)
    expect(body.members[0]?.id).toBe('c_1')
    expect(listContactsForList).toHaveBeenCalledWith(expect.anything(), 'u_1', null, {
      listId: 'l_1',
    })
  })

  it('returns 404 when the list does not exist', async () => {
    byId.mockResolvedValue(null)
    const res = await listGET(new Request('http://localhost/v1/lists/l_x'), ctx({ id: 'l_x' }))
    expect(res.status).toBe(404)
  })
})

describe('PATCH /v1/lists/[id]', () => {
  function req(body: unknown): Request {
    return new Request('http://localhost/v1/lists/l_1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  }

  it('renames and returns the updated list', async () => {
    updateName.mockResolvedValue(1)
    byId.mockResolvedValue({ ...LIST_ROW, name: 'Pickup' })
    const res = await listPATCH(req({ name: 'Pickup' }), ctx({ id: 'l_1' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string }
    expect(body.name).toBe('Pickup')
    expect(updateName).toHaveBeenCalledWith(expect.anything(), 'u_1', 'l_1', 'Pickup')
  })

  it('404s when update affects 0 rows', async () => {
    updateName.mockResolvedValue(0)
    const res = await listPATCH(req({ name: 'Pickup' }), ctx({ id: 'l_x' }))
    expect(res.status).toBe(404)
  })

  it('400s on unknown fields', async () => {
    const res = await listPATCH(req({ name: 'P', kind: 'group' }), ctx({ id: 'l_1' }))
    expect(res.status).toBe(400)
  })
})

describe('DELETE /v1/lists/[id]', () => {
  it('deletes when affected > 0', async () => {
    deleteList.mockResolvedValue(1)
    const res = await listDELETE(new Request('http://localhost/v1/lists/l_1'), ctx({ id: 'l_1' }))
    expect(res.status).toBe(200)
  })

  it('404s when affected = 0', async () => {
    deleteList.mockResolvedValue(0)
    const res = await listDELETE(new Request('http://localhost/v1/lists/l_x'), ctx({ id: 'l_x' }))
    expect(res.status).toBe(404)
  })
})

describe('POST /v1/lists/[id]/members', () => {
  function req(body: unknown): Request {
    return new Request('http://localhost/v1/lists/l_1/members', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  it('passes added=true through on a fresh add', async () => {
    addMember.mockResolvedValue(true)
    const res = await memberPOST(
      req({ contactId: '00000000-0000-0000-0000-000000000001' }),
      ctx({ id: 'l_1' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; added: boolean }
    expect(body.added).toBe(true)
  })

  it('passes added=false through on an idempotent re-add', async () => {
    addMember.mockResolvedValue(false)
    const res = await memberPOST(
      req({ contactId: '00000000-0000-0000-0000-000000000001' }),
      ctx({ id: 'l_1' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; added: boolean }
    expect(body.added).toBe(false)
  })

  it('400s on a non-UUID contactId', async () => {
    const res = await memberPOST(req({ contactId: 'not-a-uuid' }), ctx({ id: 'l_1' }))
    expect(res.status).toBe(400)
    expect(addMember).not.toHaveBeenCalled()
  })
})

describe('DELETE /v1/lists/[id]/members/[contactId]', () => {
  it('removes when affected > 0', async () => {
    removeMember.mockResolvedValue(1)
    const res = await memberDELETE(
      new Request('http://localhost/v1/lists/l_1/members/c_2', { method: 'DELETE' }),
      ctx({ id: 'l_1', contactId: 'c_2' }),
    )
    expect(res.status).toBe(200)
  })

  it('404s when affected = 0', async () => {
    removeMember.mockResolvedValue(0)
    const res = await memberDELETE(
      new Request('http://localhost/v1/lists/l_1/members/c_x', { method: 'DELETE' }),
      ctx({ id: 'l_1', contactId: 'c_x' }),
    )
    expect(res.status).toBe(404)
  })
})
