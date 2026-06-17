import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeocodingError, osmAdapter } from '../osm'

afterEach(() => {
  vi.restoreAllMocks()
})

function stubFetch(response: { ok: boolean; body: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = []
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify(response.body), {
      status: response.ok ? 200 : 500,
    })
  })
  vi.stubGlobal('fetch', f)
  return { fn: f, calls }
}

// ---------------------------------------------------------------------------
// reverseGeocode
// ---------------------------------------------------------------------------

describe('osmAdapter.reverseGeocode', () => {
  it('returns a GeocodeResult for a successful response', async () => {
    stubFetch({
      ok: true,
      body: {
        display_name: '123 Main St, Springfield, IL',
        name: 'Main St',
      },
    })

    const result = await osmAdapter.reverseGeocode({ lat: 39.78, lng: -89.65 })
    expect(result).toEqual({
      name: 'Main St',
      address: '123 Main St, Springfield, IL',
      coordinates: { lat: 39.78, lng: -89.65 },
    })
  })

  it('passes lat/lng to the Nominatim URL', async () => {
    const { calls } = stubFetch({ ok: true, body: { display_name: 'test' } })
    await osmAdapter.reverseGeocode({ lat: 40.71, lng: -74.01 })
    expect(calls[0]?.url).toContain('lat=40.71')
    expect(calls[0]?.url).toContain('lon=-74.01')
  })

  it('sends the correct user-agent header', async () => {
    const { calls } = stubFetch({ ok: true, body: { display_name: 'x' } })
    await osmAdapter.reverseGeocode({ lat: 0, lng: 0 })
    const headers = calls[0]?.init?.headers as Record<string, string>
    expect(headers['user-agent']).toContain('rando.id')
  })

  it('throws GeocodingError when the API returns a non-ok response', async () => {
    stubFetch({ ok: false, body: {} })
    await expect(osmAdapter.reverseGeocode({ lat: 0, lng: 0 })).rejects.toBeInstanceOf(
      GeocodingError,
    )
  })

  it('returns null when display_name is missing', async () => {
    stubFetch({ ok: true, body: {} })
    const result = await osmAdapter.reverseGeocode({ lat: 0, lng: 0 })
    expect(result).toBeNull()
  })

  it('falls back to display_name when name is missing', async () => {
    stubFetch({ ok: true, body: { display_name: 'Full Address' } })
    const result = await osmAdapter.reverseGeocode({ lat: 1, lng: 2 })
    expect(result).toEqual({
      name: 'Full Address',
      address: 'Full Address',
      coordinates: { lat: 1, lng: 2 },
    })
  })
})

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe('osmAdapter.search', () => {
  it('returns an array of GeocodeResults for a successful response', async () => {
    stubFetch({
      ok: true,
      body: [
        { display_name: 'Place A', lat: '40.71', lon: '-74.01' },
        { display_name: 'Place B', lat: '34.05', lon: '-118.24' },
      ],
    })

    const results = await osmAdapter.search('coffee shop')
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      name: 'Place A',
      address: 'Place A',
      coordinates: { lat: 40.71, lng: -74.01 },
    })
    expect(results[1]).toEqual({
      name: 'Place B',
      address: 'Place B',
      coordinates: { lat: 34.05, lng: -118.24 },
    })
  })

  it('URL-encodes the search query', async () => {
    const { calls } = stubFetch({ ok: true, body: [] })
    await osmAdapter.search('café & bar')
    expect(calls[0]?.url).toContain(encodeURIComponent('café & bar'))
  })

  it('throws GeocodingError on non-ok response', async () => {
    stubFetch({ ok: false, body: null })
    await expect(osmAdapter.search('test')).rejects.toBeInstanceOf(GeocodingError)
  })

  it('returns an empty array when API returns empty results', async () => {
    stubFetch({ ok: true, body: [] })
    const results = await osmAdapter.search('nonexistent place')
    expect(results).toEqual([])
  })

  it('parses lat/lon strings into numbers', async () => {
    stubFetch({
      ok: true,
      body: [{ display_name: 'X', lat: '51.5074', lon: '-0.1278' }],
    })
    const results = await osmAdapter.search('london')
    expect(results[0]?.coordinates).toEqual({ lat: 51.5074, lng: -0.1278 })
  })
})
