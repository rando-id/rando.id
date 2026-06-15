import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const config: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['dev-api.rando-id.dev'],
  transpilePackages: ['@rando/auth', '@rando/config', '@rando/db', '@rando/observability'],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default config
