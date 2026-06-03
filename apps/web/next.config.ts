import type { NextConfig } from 'next'
import { withTamagui } from '@tamagui/next-plugin'

const config: NextConfig = {
  reactStrictMode: true,
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
}

export default withTamagui({
  config: '@rando/ui/tamagui.config',
  components: ['tamagui'],
  appDir: true,
  outputCSS: process.env.NODE_ENV === 'production' ? './public/tamagui.css' : null,
})(config)
