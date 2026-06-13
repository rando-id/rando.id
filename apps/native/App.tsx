import { useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { ClerkProvider, SignedIn, SignedOut } from '@clerk/clerk-expo'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TamaguiProvider, Text, YStack } from 'tamagui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { tamaguiConfig } from '@rando/ui'
import { tokenCache } from './src/lib/token-cache'
import { SignInScreen } from './src/screens/SignInScreen'
import { ContactsScreen } from './src/screens/ContactsScreen'
import { AddContactScreen } from './src/screens/AddContactScreen'

// Single shared TanStack Query client for the native app. Defaults
// mirror the web's QueryProvider — see apps/web/src/providers/QueryProvider.tsx.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: { retry: 0 },
  },
})

const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY

type Route = { kind: 'list' } | { kind: 'new' }

function SignedInRoot() {
  const [route, setRoute] = useState<Route>({ kind: 'list' })

  if (route.kind === 'new') {
    return <AddContactScreen onDone={() => setRoute({ kind: 'list' })} />
  }
  // Mutations in the hooks layer invalidate the list query so the
  // ContactsScreen automatically refetches when we come back from
  // AddContactScreen. No more `key` remount trick.
  return <ContactsScreen onNew={() => setRoute({ kind: 'new' })} />
}

export default function App() {
  if (!PUBLISHABLE_KEY) {
    return (
      <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
        <SafeAreaView style={{ flex: 1 }}>
          <YStack flex={1} items="center" justify="center" p="$6">
            <Text text="center">
              Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in apps/native/.env.local
            </Text>
          </YStack>
        </SafeAreaView>
      </TamaguiProvider>
    )
  }

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <QueryClientProvider client={queryClient}>
        <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
          <SafeAreaView style={{ flex: 1 }}>
            <SignedIn>
              <SignedInRoot />
            </SignedIn>
            <SignedOut>
              <SignInScreen />
            </SignedOut>
            <StatusBar style="auto" />
          </SafeAreaView>
        </TamaguiProvider>
      </QueryClientProvider>
    </ClerkProvider>
  )
}
