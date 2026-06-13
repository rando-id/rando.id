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
}))

import {
  createContact as createContactFn,
  getContact as getContactFn,
  listContacts as listContactsFn,
  updateContact as updateContactFn,
} from '@rando/api-client'
import { contactKeys, useContact, useContacts, useCreateContact, useUpdateContact } from '../hooks'

const listContacts = vi.mocked(listContactsFn)
const getContact = vi.mocked(getContactFn)
const createContact = vi.mocked(createContactFn)
const updateContact = vi.mocked(updateContactFn)

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
    expect(contactKeys.list()).toEqual(['contacts', 'list', null])
    expect(contactKeys.list({ lat: 1, lng: 2 })).toEqual(['contacts', 'list', { lat: 1, lng: 2 }])
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
