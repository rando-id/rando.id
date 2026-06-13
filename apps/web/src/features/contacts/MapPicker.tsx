'use client'

// Tamagui-wrapped MapLibre map for picking a location. Single draggable
// pin; lifting it changes `onChange` with the new lat/lng. Renders
// nothing on the server — MapLibre needs `window`.

import { useEffect, useRef } from 'react'
import { YStack } from 'tamagui'
import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

/**
 * Inline OSM raster style. The MapLibre `demotiles` default is a vector
 * style with very sparse data — it looks empty even when "working", so
 * we point straight at OSM raster tiles instead. Per OSM Tile Usage
 * Policy this is OK for low-volume dev; production should switch to
 * MapTiler / Protomaps / Stadia.
 */
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 }],
}

export interface MapPickerProps {
  lat: number
  lng: number
  /** Fires when the user drags the marker or taps the map. */
  onChange: (next: { lat: number; lng: number }) => void
  /** CSS height in px. Defaults to 320. */
  height?: number
}

export function MapPicker({ lat, lng, onChange, height = 320 }: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // One-time map initialization. The container ref points at a plain
  // div (below) — MapLibre is picky about its container, and routing
  // refs through Tamagui's polymorphic wrappers proved unreliable.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [lng, lat],
      zoom: 14,
    })
    mapRef.current = map

    const marker = new maplibregl.Marker({ draggable: true, color: '#0aa' })
      .setLngLat([lng, lat])
      .addTo(map)
    markerRef.current = marker

    marker.on('dragend', () => {
      const { lng: nLng, lat: nLat } = marker.getLngLat()
      onChangeRef.current({ lat: nLat, lng: nLng })
    })

    map.on('click', (e) => {
      marker.setLngLat(e.lngLat)
      onChangeRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })

    return () => {
      marker.remove()
      map.remove()
      markerRef.current = null
      mapRef.current = null
    }
    // Intentional: this effect should run once. Prop-driven updates
    // are handled by the separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync marker + camera when parent updates lat/lng (e.g. "Use my location").
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return
    markerRef.current.setLngLat([lng, lat])
    mapRef.current.flyTo({
      center: [lng, lat],
      zoom: Math.max(mapRef.current.getZoom(), 14),
    })
  }, [lat, lng])

  return (
    <YStack
      borderWidth={1}
      borderColor="$borderColor"
      rounded="$3"
      overflow="hidden"
      height={height}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </YStack>
  )
}
