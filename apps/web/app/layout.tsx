import type { ReactNode } from 'react'
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs'
import { TamaguiProviderClient } from '../src/providers/Tamagui'

export const metadata = {
  title: 'Rando',
  description: 'Contacts organized by where you met them.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body>
          <TamaguiProviderClient>
            <header
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                padding: '12px 24px',
                borderBottom: '1px solid #eee',
                gap: 12,
              }}
            >
              <SignedOut>
                <SignInButton mode="modal" />
              </SignedOut>
              <SignedIn>
                <UserButton afterSignOutUrl="/sign-in" />
              </SignedIn>
            </header>
            {children}
          </TamaguiProviderClient>
        </body>
      </html>
    </ClerkProvider>
  )
}
