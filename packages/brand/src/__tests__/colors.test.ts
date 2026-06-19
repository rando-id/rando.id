import { describe, expect, it } from 'vitest'
import { darkColors, lightColors } from '../colors'

describe('lightColors', () => {
  it('exposes the surface palette', () => {
    expect(lightColors.surface.base).toBe('#F7F5F0')
    expect(lightColors.surface.subtle).toBe('#F1EDE8')
  })

  it('exposes ink and accent palettes', () => {
    expect(lightColors.ink.primary).toBe('#383D3B')
    expect(lightColors.ink.silhouette).toBe('#383D3B')
    expect(lightColors.accent.secondary).toBe('#E89C8A')
    expect(lightColors.accent.highlight).toBe('#F7A590')
  })
})

describe('darkColors', () => {
  it('exposes the surface palette', () => {
    expect(darkColors.surface.base).toBe('#1A1D1C')
    expect(darkColors.surface.subtle).toBe('#383D3B')
  })

  it('exposes ink and accent palettes', () => {
    expect(darkColors.ink.primary).toBe('#E8E6E2')
    expect(darkColors.ink.silhouette).toBe('#F1EDE8')
    expect(darkColors.accent.secondary).toBe('#D68F7E')
    expect(darkColors.accent.highlight).toBe('#F7A590')
  })
})
