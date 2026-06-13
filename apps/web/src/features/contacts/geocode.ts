// Minimal Nominatim (OpenStreetMap) reverse-geocoding wrapper. Direct
// client-side fetches are fine for our scale; per OSM policy this should
// be proxied via Upstash-cached server-side requests once we have
// production traffic. The spec calls this out as an open question.

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'
const USER_AGENT_HEADER_VALUE = 'rando.id/0.1 (https://rando.id)'

export interface GeocodeResult {
  /** Short display name suitable for the contact's location field. */
  displayName: string
  /** Full address string from the geocoder. */
  fullAddress: string
}

/**
 * Reverse-geocode a coordinate pair to a human-readable place name.
 * Returns null on any error or empty result — callers should fall back
 * to letting the user type the name in manually.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<GeocodeResult | null> {
  const url = new URL('/reverse', NOMINATIM_BASE)
  url.searchParams.set('lat', lat.toString())
  url.searchParams.set('lon', lng.toString())
  url.searchParams.set('format', 'json')
  url.searchParams.set('zoom', '18')
  url.searchParams.set('addressdetails', '1')

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT_HEADER_VALUE },
      signal,
    })
    if (!res.ok) return null
    const body = (await res.json()) as {
      display_name?: string
      name?: string
      address?: {
        amenity?: string
        building?: string
        road?: string
        suburb?: string
        city?: string
      }
    }
    if (!body) return null
    const fullAddress = body.display_name ?? ''
    // Prefer a specific named feature (amenity > building > road) for
    // the short label; fall back to the first two segments of the full
    // address.
    const a = body.address ?? {}
    const short =
      body.name ||
      a.amenity ||
      a.building ||
      a.road ||
      fullAddress.split(',').slice(0, 2).join(',').trim()
    if (!short) return null
    return { displayName: short, fullAddress }
  } catch {
    return null
  }
}
