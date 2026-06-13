import { describe, expect, it } from 'vitest'
import {
  buildContactPatch,
  displayName,
  formatDistance,
  validateEditContactDraft,
  validateNewContactDraft,
} from '../helpers'

describe('displayName', () => {
  it('joins first + last when both present', () => {
    expect(displayName({ firstName: 'Jane', lastName: 'Smith' })).toBe('Jane Smith')
  })

  it('returns first alone when last is missing', () => {
    expect(displayName({ firstName: 'Jane', lastName: null })).toBe('Jane')
    expect(displayName({ firstName: 'Jane', lastName: '' })).toBe('Jane')
  })

  it('returns last alone when first is missing', () => {
    expect(displayName({ firstName: null, lastName: 'Smith' })).toBe('Smith')
  })

  it('trims whitespace before joining', () => {
    expect(displayName({ firstName: '  Jane ', lastName: ' Smith ' })).toBe('Jane Smith')
  })

  it('falls back to "Unnamed" when both are empty', () => {
    expect(displayName({ firstName: null, lastName: null })).toBe('Unnamed')
    expect(displayName({ firstName: '', lastName: '   ' })).toBe('Unnamed')
  })
})

describe('formatDistance', () => {
  it('uses meters under 1km, rounded to int', () => {
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(123.7)).toBe('124 m')
    expect(formatDistance(999.4)).toBe('999 m')
  })

  it('switches to km at 1000 with one decimal', () => {
    expect(formatDistance(1000)).toBe('1.0 km')
    expect(formatDistance(1499)).toBe('1.5 km')
    expect(formatDistance(12_345)).toBe('12.3 km')
  })
})

describe('validateNewContactDraft', () => {
  it('passes when first name + location name are present', () => {
    expect(
      validateNewContactDraft({ firstName: 'Jane', lastName: '', locationName: 'Park' }),
    ).toBeNull()
  })

  it('accepts last name alone if first is missing', () => {
    expect(
      validateNewContactDraft({ firstName: '', lastName: 'Smith', locationName: 'Park' }),
    ).toBeNull()
  })

  it('rejects when both name fields are blank', () => {
    expect(
      validateNewContactDraft({ firstName: '   ', lastName: '', locationName: 'Park' }),
    ).toMatch(/first or last name/)
  })

  it('rejects when location name is blank', () => {
    expect(
      validateNewContactDraft({ firstName: 'Jane', lastName: '', locationName: '   ' }),
    ).toMatch(/location a name/)
  })
})

describe('validateEditContactDraft', () => {
  it('passes when at least one name is present', () => {
    expect(validateEditContactDraft({ firstName: 'Jane', lastName: '', notes: '' })).toBeNull()
    expect(validateEditContactDraft({ firstName: '', lastName: 'S', notes: '' })).toBeNull()
  })

  it('rejects when both names are blank — location is not part of edit', () => {
    expect(validateEditContactDraft({ firstName: ' ', lastName: '', notes: 'just notes' })).toMatch(
      /first or last name/,
    )
  })
})

describe('buildContactPatch', () => {
  const current = { firstName: 'Jane', lastName: 'Smith', notes: 'baseball mom' }

  it('returns an empty object when nothing has changed', () => {
    expect(
      buildContactPatch(current, { firstName: 'Jane', lastName: 'Smith', notes: 'baseball mom' }),
    ).toEqual({})
  })

  it('returns only the changed field', () => {
    expect(
      buildContactPatch(current, { firstName: 'Jane', lastName: 'Smith', notes: 'updated note' }),
    ).toEqual({ notes: 'updated note' })
  })

  it('normalizes whitespace and treats trimmed-blank as null', () => {
    expect(
      buildContactPatch(current, { firstName: 'Jane', lastName: '   ', notes: 'baseball mom' }),
    ).toEqual({ lastName: null })
  })

  it('detects all three fields changing at once', () => {
    expect(
      buildContactPatch(current, { firstName: 'Janet', lastName: 'Doe', notes: 'updated' }),
    ).toEqual({ firstName: 'Janet', lastName: 'Doe', notes: 'updated' })
  })

  it('treats null current and "" draft as equivalent (no patch)', () => {
    expect(
      buildContactPatch(
        { firstName: null, lastName: 'X', notes: null },
        { firstName: '', lastName: 'X', notes: '' },
      ),
    ).toEqual({})
  })
})
