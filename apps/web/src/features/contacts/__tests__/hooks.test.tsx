// Tests for the TanStack Query hooks layer. Mocks the api-client +
// useApiClient at the module boundary, then renders the hooks under a
// fresh QueryClientProvider so each test starts with an empty cache.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

// Mock useApiClient — the hook returns an opaque object that's passed
// straight to the api-client functions (which we also mock).
vi.mock('../../../lib/client-api', () => ({
  useApiClient: () => ({ stub: true }),
}))

vi.mock('@rando/api-client', () => ({
  listContacts: vi.fn(),
  getContact: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  listLists: vi.fn(),
  getList: vi.fn(),
  createList: vi.fn(),
  updateList: vi.fn(),
  deleteList: vi.fn(),
  addListMember: vi.fn(),
  removeListMember: vi.fn(),
}))

import {
  addListMember as addListMemberFn,
  createContact as createContactFn,
  createList as createListFn,
  deleteList as deleteListFn,
  getContact as getContactFn,
  getList as getListFn,
  listContacts as listContactsFn,
  listLists as listListsFn,
  removeListMember as removeListMemberFn,
  updateContact as updateContactFn,
  updateList as updateListFn,
} from '@rando/api-client'
import {
  contactKeys,
  listKeys,
  useAddListMember,
  useContact,
  useContacts,
  useCreateContact,
  useCreateList,
  useDeleteList,
  useFavorites,
  useList,
  useLists,
  useRemoveListMember,
  useUpdateContact,
  useUpdateList,
} from '../hooks'

const listContacts = vi.mocked(listContactsFn)
const getContact = vi.mocked(getContactFn)
const createContact = vi.mocked(createContactFn)
const updateContact = vi.mocked(updateContactFn)
const listLists = vi.mocked(listListsFn)
const getList = vi.mocked(getListFn)
const createList = vi.mocked(createListFn)
const updateList = vi.mocked(updateListFn)
const deleteList = vi.mocked(deleteListFn)
const addListMember = vi.mocked(addListMemberFn)
const removeListMember = vi.mocked(removeListMemberFn)

function wrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
  return {
    client,
    wrap: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  }
}

const CONTACT = {
  id: 'c_1',
  firstName: 'Jane',
  lastName: 'Smith',
  avatarKind: 'monogram' as const,
  avatarValue: null,
  favorite: false,
  promoted: false,
  location: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('contactKeys', () => {
  it('builds stable + distinct keys for list and detail', () => {
    expect(contactKeys.all).toEqual(['contacts'])
    // List key includes both `near` and `filter` slots so favorites /
    // list-filtered queries are cached separately.
    expect(contactKeys.list()).toEqual(['contacts', 'list', null, null])
    expect(contactKeys.list({ lat: 1, lng: 2 })).toEqual([
      'contacts',
      'list',
      { lat: 1, lng: 2 },
      null,
    ])
    expect(contactKeys.list({ lat: 1, lng: 2 }, { favorites: true })).toEqual([
      'contacts',
      'list',
      { lat: 1, lng: 2 },
      { favorites: true },
    ])
    expect(contactKeys.detail('c_1')).toEqual(['contacts', 'detail', 'c_1', null])
    expect(contactKeys.detail('c_1', { lat: 1, lng: 2 })).toEqual([
      'contacts',
      'detail',
      'c_1',
      { lat: 1, lng: 2 },
    ])
  })
})

describe('useContacts', () => {
  it('fires listContacts and resolves with the result', async () => {
    listContacts.mockResolvedValue([CONTACT])
    const { wrap } = wrapper()
    const { result } = renderHook(() => useContacts({ lat: 1, lng: 2 }), {
      wrapper: wrap,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([CONTACT])
    expect(listContacts).toHaveBeenCalledWith({ stub: true }, { lat: 1, lng: 2 })
  })

  it('passes an empty `near` when no coords are provided', async () => {
    listContacts.mockResolvedValue([])
    const { wrap } = wrapper()
    renderHook(() => useContacts(), { wrapper: wrap })
    await waitFor(() => expect(listContacts).toHaveBeenCalled())
    expect(listContacts).toHaveBeenCalledWith({ stub: true }, {})
  })
})

describe('useContact', () => {
  it('fires getContact and resolves with the result', async () => {
    getContact.mockResolvedValue(CONTACT)
    const { wrap } = wrapper()
    const { result } = renderHook(() => useContact('c_1'), { wrapper: wrap })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(CONTACT)
    expect(getContact).toHaveBeenCalledWith({ stub: true }, 'c_1', undefined)
  })

  it('stays disabled when id is empty (no fetch)', async () => {
    const { wrap } = wrapper()
    renderHook(() => useContact(''), { wrapper: wrap })
    // Give react a tick to flush effects.
    await new Promise((r) => setTimeout(r, 10))
    expect(getContact).not.toHaveBeenCalled()
  })
})

describe('useCreateContact', () => {
  it('invalidates the contacts subtree on success', async () => {
    createContact.mockResolvedValue({ contact: CONTACT, locationReused: false })
    const { client, wrap } = wrapper()
    // Pre-seed a list query so we can observe its invalidation.
    client.setQueryData(contactKeys.list(), [CONTACT])
    const { result } = renderHook(() => useCreateContact(), { wrapper: wrap })
    await result.current.mutateAsync({
      firstName: 'Jane',
      location: { lat: 0, lng: 0, name: 'X' },
    })
    const state = client.getQueryState(contactKeys.list())
    expect(state?.isInvalidated).toBe(true)
  })
})

describe('useUpdateContact', () => {
  it('seeds the detail cache with the response + invalidates the list', async () => {
    const updated = { ...CONTACT, favorite: true }
    updateContact.mockResolvedValue(updated)
    const { client, wrap } = wrapper()
    client.setQueryData(contactKeys.list(), [CONTACT])
    const { result } = renderHook(() => useUpdateContact('c_1'), { wrapper: wrap })
    await result.current.mutateAsync({ favorite: true })
    // Detail cache seeded so the next read returns instantly.
    expect(client.getQueryData(contactKeys.detail('c_1'))).toEqual(updated)
    // List invalidated.
    expect(client.getQueryState(contactKeys.list())?.isInvalidated).toBe(true)
  })
})

describe('useFavorites', () => {
  it('calls listContacts with favorites=true', async () => {
    listContacts.mockResolvedValue([{ ...CONTACT, favorite: true }])
    const { wrap } = wrapper()
    const { result } = renderHook(() => useFavorites(), { wrapper: wrap })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(listContacts).toHaveBeenCalledWith({ stub: true }, { favorites: true })
  })

  it('caches separately from the default list (different key)', async () => {
    listContacts.mockResolvedValue([])
    const { client, wrap } = wrapper()
    renderHook(() => useFavorites(), { wrapper: wrap })
    await waitFor(() => expect(listContacts).toHaveBeenCalled())
    expect(client.getQueryState(contactKeys.list())).toBeUndefined()
    expect(
      client.getQueryState(contactKeys.list(undefined, { favorites: true })),
    ).not.toBeUndefined()
  })
})

const LIST = {
  id: 'l_1',
  name: 'School pickup',
  kind: 'custom' as const,
  coverImage: null,
  createdAt: '2026-06-13T00:00:00Z',
  updatedAt: '2026-06-13T00:00:00Z',
  memberCount: 0,
}

describe('listKeys', () => {
  it('builds stable keys for list and detail', () => {
    expect(listKeys.all).toEqual(['lists'])
    expect(listKeys.list()).toEqual(['lists', 'list'])
    expect(listKeys.detail('l_1')).toEqual(['lists', 'detail', 'l_1', null])
  })
})

describe('useLists', () => {
  it('fires listLists', async () => {
    listLists.mockResolvedValue([LIST])
    const { wrap } = wrapper()
    const { result } = renderHook(() => useLists(), { wrapper: wrap })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([LIST])
  })
})

describe('useList', () => {
  it('fires getList with the id', async () => {
    getList.mockResolvedValue({ ...LIST, members: [] })
    const { wrap } = wrapper()
    renderHook(() => useList('l_1'), { wrapper: wrap })
    await waitFor(() => expect(getList).toHaveBeenCalled())
    expect(getList).toHaveBeenCalledWith({ stub: true }, 'l_1', undefined)
  })

  it('stays disabled for empty id', async () => {
    const { wrap } = wrapper()
    renderHook(() => useList(''), { wrapper: wrap })
    await new Promise((r) => setTimeout(r, 10))
    expect(getList).not.toHaveBeenCalled()
  })
})

describe('useCreateList', () => {
  it('invalidates the lists list cache on success', async () => {
    createList.mockResolvedValue(LIST)
    const { client, wrap } = wrapper()
    client.setQueryData(listKeys.list(), [LIST])
    const { result } = renderHook(() => useCreateList(), { wrapper: wrap })
    await result.current.mutateAsync({ name: 'New list' })
    expect(client.getQueryState(listKeys.list())?.isInvalidated).toBe(true)
  })
})

describe('useUpdateList', () => {
  it('invalidates both the list-of-lists and the detail subtree', async () => {
    updateList.mockResolvedValue(LIST)
    const { client, wrap } = wrapper()
    client.setQueryData(listKeys.list(), [LIST])
    client.setQueryData(listKeys.detail('l_1'), { ...LIST, members: [] })
    const { result } = renderHook(() => useUpdateList('l_1'), { wrapper: wrap })
    await result.current.mutateAsync({ name: 'Renamed' })
    expect(client.getQueryState(listKeys.list())?.isInvalidated).toBe(true)
    expect(client.getQueryState(listKeys.detail('l_1'))?.isInvalidated).toBe(true)
  })
})

describe('useDeleteList', () => {
  it('removes the detail cache and invalidates the list-of-lists', async () => {
    deleteList.mockResolvedValue({ ok: true })
    const { client, wrap } = wrapper()
    client.setQueryData(listKeys.list(), [LIST])
    client.setQueryData(listKeys.detail('l_1'), { ...LIST, members: [] })
    const { result } = renderHook(() => useDeleteList(), { wrapper: wrap })
    await result.current.mutateAsync({ id: 'l_1' })
    expect(client.getQueryData(listKeys.detail('l_1'))).toBeUndefined()
    expect(client.getQueryState(listKeys.list())?.isInvalidated).toBe(true)
  })
})

describe('useAddListMember + useRemoveListMember', () => {
  it('add invalidates detail + list-of-lists + contacts-list', async () => {
    addListMember.mockResolvedValue({ ok: true, added: true })
    const { client, wrap } = wrapper()
    client.setQueryData(listKeys.list(), [LIST])
    client.setQueryData(listKeys.detail('l_1'), { ...LIST, members: [] })
    client.setQueryData(contactKeys.list(), [CONTACT])
    const { result } = renderHook(() => useAddListMember('l_1'), { wrapper: wrap })
    await result.current.mutateAsync({ contactId: 'c_1' })
    expect(client.getQueryState(listKeys.detail('l_1'))?.isInvalidated).toBe(true)
    expect(client.getQueryState(listKeys.list())?.isInvalidated).toBe(true)
    expect(client.getQueryState(contactKeys.list())?.isInvalidated).toBe(true)
  })

  it('remove invalidates the same caches', async () => {
    removeListMember.mockResolvedValue({ ok: true })
    const { client, wrap } = wrapper()
    client.setQueryData(listKeys.list(), [LIST])
    client.setQueryData(listKeys.detail('l_1'), { ...LIST, members: [] })
    client.setQueryData(contactKeys.list(), [CONTACT])
    const { result } = renderHook(() => useRemoveListMember('l_1'), { wrapper: wrap })
    await result.current.mutateAsync({ contactId: 'c_1' })
    expect(client.getQueryState(listKeys.detail('l_1'))?.isInvalidated).toBe(true)
    expect(client.getQueryState(listKeys.list())?.isInvalidated).toBe(true)
    expect(client.getQueryState(contactKeys.list())?.isInvalidated).toBe(true)
  })
})
