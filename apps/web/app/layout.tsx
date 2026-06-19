import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs'
import { lightColors } from '@rando/brand'
import logo from '@rando/brand/assets/v0/logo/logo-transparent.png'
import banner from '@rando/brand/assets/v0/banner/banner-light.png'
import { TamaguiProviderClient } from '../src/providers/Tamagui'
import { QueryProvider } from '../src/providers/QueryProvider'

const title = 'Rando'
const description = 'Contacts organized by where you met them.'

export const metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    images: [{ url: banner.src, width: banner.width, height: banner.height, alt: title }],
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body
          style={{
            backgroundColor: lightColors.surface.base,
            color: lightColors.ink.primary,
            margin: 0,
          }}
        >
          <TamaguiProviderClient>
            <QueryProvider>
              <header
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 24px',
                  borderBottom: `1px solid ${lightColors.ink.primary}1A`,
                  gap: 12,
                }}
              >
                <Link
                  href="/"
                  aria-label="Rando home"
                  style={{ display: 'inline-flex', alignItems: 'center' }}
                >
                  <Image
                    src={logo}
                    alt="Rando"
                    height={32}
                    width={Math.round((logo.width / logo.height) * 32)}
                    priority
                  />
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <SignedOut>
                    <SignInButton mode="modal" />
                  </SignedOut>
                  <SignedIn>
                    <UserButton afterSignOutUrl="/sign-in" />
                  </SignedIn>
                </div>
              </header>
              {children}
            </QueryProvider>
          </TamaguiProviderClient>
        </body>
      </html>
    </ClerkProvider>
  )
}
