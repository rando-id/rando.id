import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@rando/auth',
    '@rando/config',
    '@rando/db',
    '@rando/observability',
  ],
}

export default config
