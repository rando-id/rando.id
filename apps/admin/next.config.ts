import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['dev-admin.rando-id.dev'],
  transpilePackages: ['@rando/api-client', '@rando/auth', '@rando/config', '@rando/observability'],
}

export default config
