import { ClerkProvider } from '@clerk/nextjs'

export const metadata = {
  title: 'Rando Admin',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body style={{ fontFamily: 'system-ui', margin: 0 }}>{children}</body>
      </html>
    </ClerkProvider>
  )
}
