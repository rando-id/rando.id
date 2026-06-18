import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublic = createRouteMatcher(['/', '/v1/health', '/v1/openapi.json', '/v1/webhooks/(.*)'])

const ALLOWED_ORIGINS = (
  process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3000,http://localhost:3100'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function corsHeadersFor(origin: string | null): Record<string, string> {
  // Don't fall back to ALLOWED_ORIGINS[0] for unknown origins —
  // doing so echoes an allow-* set to any caller and the browser
  // happily accepts. Unknown origin → only `Vary: Origin`, response
  // is blocked client-side.
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return { Vary: 'Origin' }
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, content-type, svix-id, svix-timestamp, svix-signature',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export default clerkMiddleware(async (auth, req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = corsHeadersFor(origin)

  // CORS preflight — short-circuit before any auth.
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders })
  }

  if (!isPublic(req)) {
    await auth.protect()
  }

  const response = NextResponse.next()
  for (const [k, v] of Object.entries(corsHeaders)) {
    response.headers.set(k, v)
  }
  return response
})

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)', '/(api|trpc)(.*)'],
}
