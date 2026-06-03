'use client'

import { useEffect, useState } from 'react'

export type GeolocationState =
  | { status: 'pending' }
  | { status: 'unsupported' }
  | { status: 'denied'; error: string }
  | { status: 'ready'; lat: number; lng: number }

export function useGeolocation(): GeolocationState {
  const [state, setState] = useState<GeolocationState>({ status: 'pending' })

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ status: 'unsupported' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setState({ status: 'ready', lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setState({ status: 'denied', error: err.message }),
      { timeout: 10_000, maximumAge: 60_000 },
    )
  }, [])

  return state
}
