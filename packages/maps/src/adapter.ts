export type LatLng = { lat: number; lng: number }

export type GeocodeResult = {
  name: string
  address: string
  coordinates: LatLng
}

export type MapsAdapter = {
  reverseGeocode: (coords: LatLng) => Promise<GeocodeResult | null>
  search: (query: string) => Promise<GeocodeResult[]>
}
