import { StatusBar } from 'expo-status-bar'
import { ClerkProvider, SignedIn, SignedOut } from '@clerk/clerk-expo'
import { SafeAreaView } from 'react-native'
import { TamaguiProvider, Text, YStack } from 'tamagui'
import { tamaguiConfig } from '@rando/ui/tamagui.config'
import { tokenCache } from './src/lib/token-cache'
import { SignInScreen } from './src/screens/SignInScreen'
import { ContactsScreen } from './src/screens/ContactsScreen'

const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY

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
            <ContactsScreen />
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
