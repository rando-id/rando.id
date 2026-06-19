import { DEFAULT_THEME } from './default.theme'

export type ThemeMode = 'light' | 'dark' | 'system'

export type ThemePalette = {
  background: string
  foreground: string
  primary: string
  secondary: string
  accent: string
  muted: string
  border: string
}

export type ThemePack = {
  id: string
  name: string
  kind: 'default' | 'seasonal' | 'custom'
  light: ThemePalette
  dark: ThemePalette
  activeFrom?: { month: number; day: number }
  activeTo?: { month: number; day: number }
  isPaid: boolean
}

export const FREE_THEME_LIMIT = 2
export const PAID_THEME_LIMIT = 5

// Re-export every concrete theme pack so consumers can import either
// the individual constant or pull from THEME_PACKS below.
export { DEFAULT_THEME }

export const DEFAULT_THEME_ID = DEFAULT_THEME.id

// Registry of every selectable theme pack. To add a new theme: create
// `<name>.theme.ts` in this directory, import it above, then append
// the constant here. The "pick a theme" UI stays data-driven against
// this list. See `example.theme.ts` for the template.
export const THEME_PACKS: readonly ThemePack[] = [DEFAULT_THEME]

export function getThemePack(packs: readonly ThemePack[], id: string): ThemePack | undefined {
  return packs.find((pack) => pack.id === id)
}

// Returns the seasonal packs whose activeFrom..activeTo window covers
// `now`. Windows are month/day only (recurring annually), so we encode
// each as month*100 + day for ordered comparison. A window where
// `from > to` wraps the year boundary (e.g. Dec 15 → Jan 5).
export function getActiveSeasonalPacks(packs: readonly ThemePack[], now: Date): ThemePack[] {
  const month = now.getMonth() + 1
  const day = now.getDate()
  return packs.filter((pack) => {
    if (pack.kind !== 'seasonal' || !pack.activeFrom || !pack.activeTo) {
      return false
    }
    return isWithinSeasonalWindow(pack.activeFrom, pack.activeTo, month, day)
  })
}

export function isWithinSeasonalWindow(
  from: { month: number; day: number },
  to: { month: number; day: number },
  month: number,
  day: number,
): boolean {
  const fromValue = from.month * 100 + from.day
  const toValue = to.month * 100 + to.day
  const nowValue = month * 100 + day
  if (fromValue <= toValue) {
    return nowValue >= fromValue && nowValue <= toValue
  }
  return nowValue >= fromValue || nowValue <= toValue
}
