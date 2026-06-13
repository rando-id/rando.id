// Mirror of apps/web/src/features/contacts/hooks.ts. The shape is
// identical because both apps consume the same @rando/api-client and
// want the same caching semantics; we duplicate the file for now
// because moving it into @rando/api-client would force React + TanStack
// Query as deps on what's otherwise a platform-neutral package.

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
import { useApiClient } from './client-api'

export type Near = { lat: number; lng: number } | undefined

export const contactKeys = {
  all: ['contacts'] as const,
  list: (near?: Near) => ['contacts', 'list', near ?? null] as const,
  detail: (id: string, near?: Near) => ['contacts', 'detail', id, near ?? null] as const,
}

export function useContacts(near?: Near): UseQueryResult<ContactListItem[], Error> {
  const api = useApiClient()
  return useQuery({
    queryKey: contactKeys.list(near),
    queryFn: () => listContacts(api, near ?? {}),
  })
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
