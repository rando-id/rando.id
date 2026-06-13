import { describe, expect, it } from 'vitest'
import { expandApps, KNOWN_APPS, parseAppNames } from '../dev/deps'

describe('parseAppNames', () => {
  it('returns all known apps when input is empty', () => {
    expect(parseAppNames([])).toEqual([...KNOWN_APPS])
  })

  it('returns the requested apps when they are known', () => {
    expect(parseAppNames(['web'])).toEqual(['web'])
    expect(parseAppNames(['api', 'web'])).toEqual(['api', 'web'])
  })

  it('throws on unknown app names', () => {
    expect(() => parseAppNames(['ghost'])).toThrow(/Unknown app "ghost"/)
  })
})

describe('expandApps', () => {
  it('pulls api in as a dependency for web/admin/native', () => {
    expect(expandApps(['web'])).toEqual(['api', 'web'])
    expect(expandApps(['admin'])).toEqual(['api', 'admin'])
    expect(expandApps(['native'])).toEqual(['api', 'native'])
  })

  it('only includes api once when multiple dependents are requested', () => {
    expect(expandApps(['web', 'admin'])).toEqual(['api', 'web', 'admin'])
    expect(expandApps(['native', 'web', 'admin'])).toEqual(['api', 'native', 'web', 'admin'])
  })

  it('passes api alone through unchanged', () => {
    expect(expandApps(['api'])).toEqual(['api'])
  })

  it('keeps deps before dependents (api before web)', () => {
    const out = expandApps(['web', 'api'])
    expect(out.indexOf('api')).toBeLessThan(out.indexOf('web'))
  })
})
