import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  DEFAULT_THEME_ID,
  FREE_THEME_LIMIT,
  PAID_THEME_LIMIT,
  THEME_PACKS,
  type ThemePack,
  getActiveSeasonalPacks,
  getThemePack,
  isWithinSeasonalWindow,
} from '../themes'

const dummyPalette = {
  background: '#000',
  foreground: '#fff',
  primary: '#000',
  secondary: '#000',
  accent: '#000',
  muted: '#000',
  border: '#000',
}

const makePack = (overrides: Partial<ThemePack> = {}): ThemePack => ({
  id: 'test-pack',
  name: 'Test Pack',
  kind: 'seasonal',
  light: dummyPalette,
  dark: dummyPalette,
  isPaid: false,
  activeFrom: { month: 7, day: 1 },
  activeTo: { month: 8, day: 31 },
  ...overrides,
})

describe('theme constants', () => {
  it('exposes limit constants', () => {
    expect(FREE_THEME_LIMIT).toBe(2)
    expect(PAID_THEME_LIMIT).toBe(5)
  })

  it('DEFAULT_THEME_ID matches DEFAULT_THEME.id', () => {
    expect(DEFAULT_THEME_ID).toBe(DEFAULT_THEME.id)
    expect(DEFAULT_THEME_ID).toBe('default')
  })

  it('THEME_PACKS includes the default', () => {
    expect(THEME_PACKS).toContain(DEFAULT_THEME)
  })
})

describe('getThemePack', () => {
  it('returns a pack matching the id', () => {
    expect(getThemePack(THEME_PACKS, 'default')).toBe(DEFAULT_THEME)
  })

  it('returns undefined for an unknown id', () => {
    expect(getThemePack(THEME_PACKS, 'no-such-pack')).toBeUndefined()
  })
})

describe('getActiveSeasonalPacks', () => {
  const summerPack = makePack({
    id: 'summer',
    activeFrom: { month: 6, day: 1 },
    activeTo: { month: 8, day: 31 },
  })
  const winterPack = makePack({
    id: 'winter',
    activeFrom: { month: 12, day: 15 },
    activeTo: { month: 1, day: 5 },
  })
  const seasonalWithoutFrom = makePack({ id: 'no-from', activeFrom: undefined })
  const seasonalWithoutTo = makePack({ id: 'no-to', activeTo: undefined })
  const nonSeasonal = makePack({ id: 'always-on', kind: 'default' })

  const allPacks: ThemePack[] = [
    summerPack,
    winterPack,
    seasonalWithoutFrom,
    seasonalWithoutTo,
    nonSeasonal,
  ]

  it('returns seasonal packs within their window', () => {
    const julyFourth = new Date(2026, 6, 4) // month index 6 = July
    const active = getActiveSeasonalPacks(allPacks, julyFourth)
    expect(active).toContain(summerPack)
    expect(active).not.toContain(winterPack)
  })

  it('handles year-wrapping windows on both halves', () => {
    const newYearsEve = new Date(2026, 11, 31)
    const newYearsDay = new Date(2027, 0, 1)
    expect(getActiveSeasonalPacks(allPacks, newYearsEve)).toContain(winterPack)
    expect(getActiveSeasonalPacks(allPacks, newYearsDay)).toContain(winterPack)
  })

  it('ignores non-seasonal packs', () => {
    const julyFourth = new Date(2026, 6, 4)
    expect(getActiveSeasonalPacks(allPacks, julyFourth)).not.toContain(nonSeasonal)
  })

  it('ignores seasonal packs missing activeFrom or activeTo', () => {
    const julyFourth = new Date(2026, 6, 4)
    const active = getActiveSeasonalPacks(allPacks, julyFourth)
    expect(active).not.toContain(seasonalWithoutFrom)
    expect(active).not.toContain(seasonalWithoutTo)
  })

  it('returns nothing when no pack is in window', () => {
    const february = new Date(2026, 1, 15)
    expect(getActiveSeasonalPacks(allPacks, february)).toHaveLength(0)
  })
})

describe('isWithinSeasonalWindow', () => {
  describe('normal window (from <= to)', () => {
    const from = { month: 7, day: 1 }
    const to = { month: 8, day: 31 }

    it('returns true at the start boundary', () => {
      expect(isWithinSeasonalWindow(from, to, 7, 1)).toBe(true)
    })

    it('returns true at the end boundary', () => {
      expect(isWithinSeasonalWindow(from, to, 8, 31)).toBe(true)
    })

    it('returns false before the window', () => {
      expect(isWithinSeasonalWindow(from, to, 6, 30)).toBe(false)
    })

    it('returns false after the window', () => {
      expect(isWithinSeasonalWindow(from, to, 9, 1)).toBe(false)
    })
  })

  describe('wrapping window (from > to)', () => {
    const from = { month: 12, day: 15 }
    const to = { month: 1, day: 5 }

    it('returns true in the from-side range', () => {
      expect(isWithinSeasonalWindow(from, to, 12, 20)).toBe(true)
    })

    it('returns true in the to-side range', () => {
      expect(isWithinSeasonalWindow(from, to, 1, 3)).toBe(true)
    })

    it('returns false in the middle of the year (outside the wrap)', () => {
      expect(isWithinSeasonalWindow(from, to, 6, 15)).toBe(false)
    })
  })
})
