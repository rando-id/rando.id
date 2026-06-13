// View-model layer for contacts + lists. TanStack Query hooks wrap the
// @rando/api-client calls so screens don't repeat the
// useEffect+useState dance and so updates in one screen reflect
// everywhere via the shared cache.

'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  addListMember,
  createContact,
  createList,
  deleteList,
  getContact,
  getList,
  listContacts,
  listLists,
  removeListMember,
  updateContact,
  updateList,
  type ContactListItem,
  type CreateContactInput,
  type CreateContactResult,
  type ListItem,
  type ListWithMembers,
  type UpdateContactInput,
} from '@rando/api-client'
import { useApiClient } from '../../lib/client-api'

export type Near = { lat: number; lng: number } | undefined
export type ContactsFilter = {
  favorites?: boolean
  listId?: string
  q?: string
  sort?: 'distance' | 'last_name' | 'date_added' | 'date_updated'
}

export const contactKeys = {
  all: ['contacts'] as const,
  list: (near?: Near, filter?: ContactsFilter) =>
    ['contacts', 'list', near ?? null, filter ?? null] as const,
  detail: (id: string, near?: Near) => ['contacts', 'detail', id, near ?? null] as const,
}

export const listKeys = {
  all: ['lists'] as const,
  list: () => ['lists', 'list'] as const,
  detail: (id: string, near?: Near) => ['lists', 'detail', id, near ?? null] as const,
}

// ── Contacts ──────────────────────────────────────────────────────────────

export function useContacts(
  near?: Near,
  filter?: ContactsFilter,
): UseQueryResult<ContactListItem[], Error> {
  const api = useApiClient()
  return useQuery({
    queryKey: contactKeys.list(near, filter),
    queryFn: () =>
      listContacts(api, {
        ...(near ?? {}),
        ...(filter ?? {}),
      }),
  })
}

/** Convenience: contacts filtered to favorites. */
export function useFavorites(near?: Near): UseQueryResult<ContactListItem[], Error> {
  return useContacts(near, { favorites: true })
}

export function useContact(id: string, near?: Near): UseQueryResult<ContactListItem, Error> {
  const api = useApiClient()
  return useQuery({
    queryKey: contactKeys.detail(id, near),
    queryFn: () => getContact(api, id, near),
    enabled: !!id,
  })
}

export function useCreateContact(): UseMutationResult<
  CreateContactResult,
  Error,
  CreateContactInput
> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateContactInput) => createContact(api, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactKeys.all })
    },
  })
}

export function useUpdateContact(
  id: string,
  near?: Near,
): UseMutationResult<ContactListItem, Error, UpdateContactInput> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: UpdateContactInput) => updateContact(api, id, patch, near),
    onSuccess: (updated) => {
      queryClient.setQueryData(contactKeys.detail(id, near), updated)
      void queryClient.invalidateQueries({ queryKey: ['contacts', 'list'] })
    },
  })
}

// ── Lists ────────────────────────────────────────────────────────────────

export function useLists(): UseQueryResult<ListItem[], Error> {
  const api = useApiClient()
  return useQuery({
    queryKey: listKeys.list(),
    queryFn: () => listLists(api),
  })
}

export function useList(id: string, near?: Near): UseQueryResult<ListWithMembers, Error> {
  const api = useApiClient()
  return useQuery({
    queryKey: listKeys.detail(id, near),
    queryFn: () => getList(api, id, near ? { lat: near.lat, lng: near.lng } : undefined),
    enabled: !!id,
  })
}

export function useCreateList(): UseMutationResult<ListItem, Error, { name: string }> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name }: { name: string }) => createList(api, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKeys.list() })
    },
  })
}

export function useUpdateList(id: string): UseMutationResult<ListItem, Error, { name: string }> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name }: { name: string }) => updateList(api, id, { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKeys.list() })
      void queryClient.invalidateQueries({ queryKey: ['lists', 'detail', id] })
    },
  })
}

export function useDeleteList(): UseMutationResult<{ ok: true }, Error, { id: string }> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string }) => deleteList(api, id),
    onSuccess: (_data, { id }) => {
      queryClient.removeQueries({ queryKey: ['lists', 'detail', id] })
      void queryClient.invalidateQueries({ queryKey: listKeys.list() })
    },
  })
}

export function useAddListMember(
  listId: string,
): UseMutationResult<{ ok: true; added: boolean }, Error, { contactId: string }> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ contactId }: { contactId: string }) => addListMember(api, listId, contactId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lists', 'detail', listId] })
      void queryClient.invalidateQueries({ queryKey: listKeys.list() })
      void queryClient.invalidateQueries({ queryKey: ['contacts', 'list'] })
    },
  })
}

export function useRemoveListMember(
  listId: string,
): UseMutationResult<{ ok: true }, Error, { contactId: string }> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ contactId }: { contactId: string }) => removeListMember(api, listId, contactId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lists', 'detail', listId] })
      void queryClient.invalidateQueries({ queryKey: listKeys.list() })
      void queryClient.invalidateQueries({ queryKey: ['contacts', 'list'] })
    },
  })
}
