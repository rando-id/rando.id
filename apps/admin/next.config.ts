import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@rando/api-client',
    '@rando/auth',
    '@rando/config',
    '@rando/observability',
  ],
}

export default config
