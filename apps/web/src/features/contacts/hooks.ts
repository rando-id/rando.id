// View-model layer for the contacts feature. TanStack Query hooks wrap
// the @rando/api-client calls so screens don't repeat the
// useEffect+useState dance and so updates in one screen reflect
// everywhere (shared cache).
//
// Query keys live in `contactKeys` so invalidations stay in sync as the
// API surface grows. Mutations invalidate the list cache so newly-
// created or edited contacts appear without a manual refresh.

'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  createContact,
  getContact,
  listContacts,
  updateContact,
  type ContactListItem,
  type CreateContactInput,
  type CreateContactResult,
  type UpdateContactInput,
} from '@rando/api-client'
import { useApiClient } from '../../lib/client-api'

export type Near = { lat: number; lng: number } | undefined

export const contactKeys = {
  all: ['contacts'] as const,
  list: (near?: Near) => ['contacts', 'list', near ?? null] as const,
  detail: (id: string, near?: Near) => ['contacts', 'detail', id, near ?? null] as const,
}

/** Read: list of contacts sorted by distance (or alphabetical if `near` undefined). */
export function useContacts(near?: Near): UseQueryResult<ContactListItem[], Error> {
  const api = useApiClient()
  return useQuery({
    queryKey: contactKeys.list(near),
    queryFn: () => listContacts(api, near ?? {}),
  })
}

/** Read: a single contact by id. */
export function useContact(id: string, near?: Near): UseQueryResult<ContactListItem, Error> {
  const api = useApiClient()
  return useQuery({
    queryKey: contactKeys.detail(id, near),
    queryFn: () => getContact(api, id, near),
    enabled: !!id,
  })
}

/** Write: create a new contact. Invalidates list queries on success. */
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
      // Any list view (with any `near`) is now stale. Drop the whole
      // "contacts" subtree so list + detail revalidate on next read.
      void queryClient.invalidateQueries({ queryKey: contactKeys.all })
    },
  })
}

/** Write: update an existing contact. Invalidates list + detail caches. */
export function useUpdateContact(
  id: string,
  near?: Near,
): UseMutationResult<ContactListItem, Error, UpdateContactInput> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: UpdateContactInput) => updateContact(api, id, patch, near),
    onSuccess: (updated) => {
      // Seed the detail cache with the fresh row so the view re-renders
      // without an extra round trip.
      queryClient.setQueryData(contactKeys.detail(id, near), updated)
      // Lists may have changed (favorite, name) — invalidate them.
      void queryClient.invalidateQueries({ queryKey: ['contacts', 'list'] })
    },
  })
}
