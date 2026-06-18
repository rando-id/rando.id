import type { NextConfig } from 'next'

// Baseline security headers — applied to every response so the admin
// surface gets the same default hardening as web + api.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const config: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['dev-admin.rando-id.dev'],
  transpilePackages: [
    '@rando/api-client',
    '@rando/auth',
    '@rando/brand',
    '@rando/config',
    '@rando/observability',
  ],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default config
