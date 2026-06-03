import type { MapsAdapter, GeocodeResult, LatLng } from './adapter'

// Nominatim (OSM) adapter. Heads-up: free Nominatim has aggressive rate
// limits — production usage requires a self-hosted instance or a paid
// alternative. This implementation is intentionally minimal.

const USER_AGENT = 'rando.id/0.0.0 (https://rando.id)'

export const osmAdapter: MapsAdapter = {
  async reverseGeocode({ lat, lng }: LatLng): Promise<GeocodeResult | null> {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
    if (!res.ok) return null
    const data = (await res.json()) as { display_name?: string; name?: string }
    if (!data.display_name) return null
    return {
      name: data.name ?? data.display_name,
      address: data.display_name,
      coordinates: { lat, lng },
    }
  },
  async search(query: string): Promise<GeocodeResult[]> {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
    if (!res.ok) return []
    const data = (await res.json()) as Array<{
      display_name: string
      lat: string
      lon: string
    }>
    return data.map((d) => ({
      name: d.display_name,
      address: d.display_name,
      coordinates: { lat: parseFloat(d.lat), lng: parseFloat(d.lon) },
    }))
  },
}
