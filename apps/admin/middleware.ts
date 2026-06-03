import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublic = createRouteMatcher(['/sign-in(.*)'])

function parseAllowlist(): string[] {
  return (process.env.ADMIN_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return
  const { userId, sessionClaims } = await auth()
  if (!userId) {
    await auth.protect()
    return
  }
  const email = (sessionClaims?.email as string | undefined)?.toLowerCase()
  const allowlist = parseAllowlist()
  if (allowlist.length === 0 || !email || !allowlist.includes(email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
})

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)', '/(api|trpc)(.*)'],
}
