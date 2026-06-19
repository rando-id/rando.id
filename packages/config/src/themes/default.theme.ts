import { darkColors, lightColors } from '@rando/brand'
import type { ThemePack } from './index'

// Default Rando theme pack — sources every value from @rando/brand so
// the palette stays single-source. `silhouette` doesn't have a standard
// ThemePalette slot; consumers needing it (avatar components) reach
// for `@rando/brand`'s {light,dark}Colors directly.
export const DEFAULT_THEME: ThemePack = {
  id: 'default',
  name: 'Rando',
  kind: 'default',
  isPaid: false,
  light: {
    background: lightColors.surface.base,
    foreground: lightColors.ink.primary,
    primary: lightColors.ink.primary,
    secondary: lightColors.accent.secondary,
    accent: lightColors.accent.highlight,
    muted: lightColors.surface.subtle,
    border: lightColors.ink.primary,
  },
  dark: {
    background: darkColors.surface.base,
    foreground: darkColors.ink.primary,
    primary: darkColors.ink.primary,
    secondary: darkColors.accent.secondary,
    accent: darkColors.accent.highlight,
    muted: darkColors.surface.subtle,
    border: darkColors.ink.primary,
  },
}
