import { afterEach, describe, expect, it, vi } from 'vitest'
import { reverseGeocode } from '../geocode'

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetch(impl: (input: RequestInfo | URL) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl as typeof fetch))
}

describe('reverseGeocode', () => {
  it('returns a short displayName from `name` when present', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            display_name: 'Wilson Park, Torrance, CA, USA',
            name: 'Wilson Park',
            address: { amenity: 'Wilson Park' },
          }),
          { status: 200 },
        ),
    )
    const result = await reverseGeocode(33.94, -118.41)
    expect(result).toEqual({
      displayName: 'Wilson Park',
      fullAddress: 'Wilson Park, Torrance, CA, USA',
    })
  })

  it('falls back to address.amenity when no top-level name', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            display_name: 'Some Park, Town, ST, USA',
            address: { amenity: 'Some Park' },
          }),
          { status: 200 },
        ),
    )
    const result = await reverseGeocode(0, 0)
    expect(result?.displayName).toBe('Some Park')
  })

  it('falls back to first two segments of display_name when nothing else', async () => {
    mockFetch(
      () => new Response(JSON.stringify({ display_name: 'Foo, Bar, Baz' }), { status: 200 }),
    )
    const result = await reverseGeocode(0, 0)
    expect(result?.displayName).toBe('Foo, Bar')
  })

  it('returns null on non-2xx', async () => {
    mockFetch(() => new Response('rate limit', { status: 429 }))
    expect(await reverseGeocode(0, 0)).toBeNull()
  })

  it('returns null when fetch throws (network error / abort)', async () => {
    mockFetch(() => Promise.reject(new Error('aborted')))
    expect(await reverseGeocode(0, 0)).toBeNull()
  })

  it('passes lat + lng + zoom + format in the URL', async () => {
    const calls: string[] = []
    mockFetch((input) => {
      calls.push(input.toString())
      return new Response(JSON.stringify({ display_name: 'X' }), { status: 200 })
    })
    await reverseGeocode(33.94, -118.41)
    expect(calls[0]).toContain('lat=33.94')
    expect(calls[0]).toContain('lon=-118.41')
    expect(calls[0]).toContain('format=json')
    expect(calls[0]).toContain('addressdetails=1')
  })
})
