// Template for adding a new theme pack to Rando.
//
// To create a new theme:
//   1. Copy this file to `<theme-name>.theme.ts` in this directory.
//   2. Rename `EXAMPLE_THEME` to your theme's SCREAMING_SNAKE_CASE
//      constant (e.g. `HOLIDAY_THEME`).
//   3. Fill in every field. Sourcing palette values from `@rando/brand`
//      keeps the brand-as-source-of-truth pattern; one-off custom packs
//      can inline hex values directly.
//   4. Register the constant in `./index.ts` — add to the imports AND
//      append to `THEME_PACKS`. (Consider also exporting it from
//      `index.ts` if it should be importable by name.)
//   5. For seasonal packs, set `activeFrom` and `activeTo` —
//      `getActiveSeasonalPacks(THEME_PACKS, now)` resolves the active
//      set at runtime, including year-wrapping windows.
//
// This file compiles but is NOT registered in `THEME_PACKS`. Keep it
// in sync with the `ThemePack` type so it always documents what a real
// theme has to include — that's the "living document" part.

import type { ThemePack } from './index'

export const EXAMPLE_THEME: ThemePack = {
  // Unique slug for storage / URL params / user preferences. Stable
  // across versions — renaming this breaks every saved preference.
  id: 'example',

  // Human-readable name shown in the theme picker UI.
  name: 'Example',

  // 'default' — ships with the app, always available.
  // 'seasonal' — active only during the activeFrom..activeTo window.
  // 'custom' — user-created or one-off (org-branded packs, etc).
  kind: 'seasonal',

  // Gates visibility behind the paid tier. Free users see up to
  // FREE_THEME_LIMIT packs; paid users see up to PAID_THEME_LIMIT.
  isPaid: false,

  // Annually-recurring window during which a seasonal pack should
  // appear in the active set. Month is 1-12, day is 1-31. Windows
  // that wrap the year boundary (e.g. Dec 15 → Jan 5) are supported.
  // Omit both fields entirely for non-seasonal packs.
  activeFrom: { month: 12, day: 15 },
  activeTo: { month: 1, day: 5 },

  // Light palette — used when the user is in light mode (or system
  // resolves to light). Every field is required by ThemePalette.
  light: {
    background: '#FFFFFF', // page background
    foreground: '#1A1A1A', // primary text
    primary: '#1A1A1A', // main brand color — buttons, links
    secondary: '#777777', // secondary actions
    accent: '#FF6B6B', // selection / focused-state highlight
    muted: '#F5F5F5', // subtle surfaces — cards, dividers
    border: '#1A1A1A', // strokes between sections
  },

  // Dark palette — same slots as light, inverted for dark mode.
  dark: {
    background: '#1A1A1A',
    foreground: '#FFFFFF',
    primary: '#FFFFFF',
    secondary: '#999999',
    accent: '#FF6B6B',
    muted: '#2A2A2A',
    border: '#FFFFFF',
  },
}
