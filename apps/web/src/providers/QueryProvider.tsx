'use client'

// TanStack Query provider — single shared cache across the app. Defaults
// are tuned for the rando.id use case:
// - staleTime: 30s so revisiting a screen doesn't refetch immediately
// - refetchOnWindowFocus: false so background tabs don't thrash the API
// - retry: 1 so transient network blips get one bite, but persistent
//   failures surface fast

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export function QueryProvider({ children }: { children: ReactNode }) {
  // Build the client once per provider mount. Lazy via useState so SSR
  // doesn't share clients across requests.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
