import { auth } from '@clerk/nextjs/server'
import { createApiClient } from '@rando/api-client'

export function serverApiClient() {
  const baseUrl = process.env.NEXT_PUBLIC_RANDO_API_URL ?? 'http://localhost:4000'
  return createApiClient({
    baseUrl,
    getToken: async () => {
      const { getToken } = await auth()
      return getToken()
    },
  })
}
