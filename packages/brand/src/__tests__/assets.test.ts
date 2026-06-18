import { describe, expect, it } from 'vitest'
import { assets } from '../assets'

describe('assets', () => {
  it('exposes the v0 logo set', () => {
    expect(assets.v0.logo.svg).toBe('v0/logo/logo.svg')
    expect(assets.v0.logo.png).toBe('v0/logo/logo.png')
    expect(assets.v0.logo.pngTransparent).toBe('v0/logo/logo-transparent.png')
  })

  it('exposes the v0 banner set', () => {
    expect(assets.v0.banner.light).toBe('v0/banner/banner-light.png')
    expect(assets.v0.banner.dark).toBe('v0/banner/banner-dark.png')
  })
})
