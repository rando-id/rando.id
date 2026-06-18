import Image from 'next/image'
import Link from 'next/link'
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/nextjs'
import logo from '@rando/brand/assets/v0/logo/logo-transparent.png'

export const metadata = {
  title: 'Rando Admin',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body style={{ fontFamily: 'system-ui', margin: 0 }}>
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 24px',
              borderBottom: '1px solid #eee',
              gap: 12,
            }}
          >
            <Link
              href="/"
              aria-label="Rando Admin home"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <Image
                src={logo}
                alt="Rando"
                height={32}
                width={Math.round((logo.width / logo.height) * 32)}
                priority
              />
              <span style={{ fontWeight: 600, fontSize: 14, color: '#666' }}>Admin</span>
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
        </body>
      </html>
    </ClerkProvider>
  )
}
