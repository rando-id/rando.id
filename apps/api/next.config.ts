import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['dev-api.rando-id.dev'],
  transpilePackages: ['@rando/auth', '@rando/config', '@rando/db', '@rando/observability'],
}

export default config
