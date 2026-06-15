import type { NextConfig } from 'next'
import { withTamagui } from '@tamagui/next-plugin'

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
]

const config: NextConfig = {
  reactStrictMode: true,
  // Allow the dev Cloudflare Tunnel hostnames to reach `next dev` — without
  // this, Next.js 15+ blocks any request whose Host header isn't localhost.
  allowedDevOrigins: ['dev-web.rando-id.dev'],
  transpilePackages: [
    '@rando/api-client',
    '@rando/auth',
    '@rando/config',
    '@rando/maps',
    '@rando/observability',
    '@rando/ui',
    'tamagui',
    '@tamagui/config',
    '@tamagui/next-theme',
  ],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default withTamagui({
  config: '@rando/ui/tamagui.config',
  components: ['tamagui'],
  appDir: true,
  outputCSS: process.env.NODE_ENV === 'production' ? './public/tamagui.css' : null,
})(config)
