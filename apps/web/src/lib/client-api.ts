'use client'

import { useAuth } from '@clerk/nextjs'
import { useMemo } from 'react'
import { createApiClient, type ApiClient } from '@rando/api-client'

const BASE_URL = process.env.NEXT_PUBLIC_RANDO_API_URL ?? 'http://localhost:4000'

export function useApiClient(): ApiClient {
  const { getToken } = useAuth()
  return useMemo(
    () => createApiClient({ baseUrl: BASE_URL, getToken: () => getToken() }),
    [getToken],
  )
}
