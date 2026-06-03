import type { ReactNode } from 'react'
import { ClerkProvider } from '@clerk/nextjs'
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
          <TamaguiProviderClient>{children}</TamaguiProviderClient>
        </body>
      </html>
    </ClerkProvider>
  )
}
