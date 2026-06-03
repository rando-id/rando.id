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
