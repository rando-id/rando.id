import * as Location from 'expo-location'
import { useEffect, useState } from 'react'

export type GeolocationState =
  | { status: 'pending' }
  | { status: 'denied'; error: string }
  | { status: 'ready'; lat: number; lng: number }

export function useGeolocation(): GeolocationState {
  const [state, setState] = useState<GeolocationState>({ status: 'pending' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (cancelled) return
        if (status !== 'granted') {
          setState({ status: 'denied', error: 'Permission not granted' })
          return
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        })
        if (cancelled) return
        setState({
          status: 'ready',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        })
      } catch (e) {
        if (cancelled) return
        setState({
          status: 'denied',
          error: e instanceof Error ? e.message : String(e),
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
