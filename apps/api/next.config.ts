import type { NextConfig } from 'next'

// Baseline security headers. Empty Permissions-Policy because the API
// has no browser-facing features — geolocation/camera/mic would only
// be relevant if we served HTML, which we don't.
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
