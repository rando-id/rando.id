import { useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { ClerkProvider, SignedIn, SignedOut } from '@clerk/clerk-expo'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TamaguiProvider, Text, YStack } from 'tamagui'
import { tamaguiConfig } from '@rando/ui'
import { tokenCache } from './src/lib/token-cache'
import { SignInScreen } from './src/screens/SignInScreen'
import { ContactsScreen } from './src/screens/ContactsScreen'
import { AddContactScreen } from './src/screens/AddContactScreen'

const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY

type Route = { kind: 'list' } | { kind: 'new' }

function SignedInRoot() {
  const [route, setRoute] = useState<Route>({ kind: 'list' })
  // Bump a counter to force ContactsScreen to refresh after a create —
  // it re-fetches on `key` change. Tiny "navigation" until we adopt
  // React Navigation or Expo Router properly.
  const [refresh, setRefresh] = useState(0)

  if (route.kind === 'new') {
    return (
      <AddContactScreen
        onDone={() => {
          setRefresh((n) => n + 1)
          setRoute({ kind: 'list' })
        }}
      />
    )
  }
  return <ContactsScreen key={refresh} onNew={() => setRoute({ kind: 'new' })} />
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
    </ClerkProvider>
  )
}
