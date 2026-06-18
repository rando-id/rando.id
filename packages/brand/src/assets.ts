// Brand asset path registry. Each value is the file's path relative
// to the package's `assets/` root. Drop new files into ../assets/
// (versioned under v0/ today; bump to v1/ when the brand evolves)
// and add a typed entry below.
//
// Two ways for apps to consume:
//
// 1. Direct sub-path import (preferred — each app's bundler resolves):
//      import logo from '@rando/brand/assets/v0/logo/logo.svg'
//      <Image src={logo} ... />
//
// 2. Via this registry, for runtime path composition:
//      import { assets } from '@rando/brand'
//      assets.v0.logo.svg === 'v0/logo/logo.svg'
//      // join with your own base URL / require / asset pipeline

export const assets = {
  v0: {
    logo: {
      svg: 'v0/logo/logo.svg',
      png: 'v0/logo/logo.png',
      pngTransparent: 'v0/logo/logo-transparent.png',
    },
    banner: {
      light: 'v0/banner/banner-light.png',
      dark: 'v0/banner/banner-dark.png',
    },
  },
} as const
