import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGeolocation } from '../use-geolocation'

let getCurrentPosition: ReturnType<typeof vi.fn>

beforeEach(() => {
  getCurrentPosition = vi.fn()
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useGeolocation', () => {
  it('returns ready with lat/lng when the device resolves a position', async () => {
    getCurrentPosition.mockImplementation((onSuccess: PositionCallback) => {
      onSuccess({
        coords: {
          latitude: 33.94,
          longitude: -118.41,
        } as GeolocationCoordinates,
      } as GeolocationPosition)
    })
    const { result } = renderHook(() => useGeolocation())
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    if (result.current.status !== 'ready') throw new Error('unreachable')
    expect(result.current.lat).toBe(33.94)
    expect(result.current.lng).toBe(-118.41)
  })

  it('returns denied with the error message when the device errors', async () => {
    getCurrentPosition.mockImplementation(
      (_ok: PositionCallback, onError: PositionErrorCallback) => {
        onError({ message: 'User denied geolocation', code: 1 } as GeolocationPositionError)
      },
    )
    const { result } = renderHook(() => useGeolocation())
    await waitFor(() => {
      expect(result.current.status).toBe('denied')
    })
    if (result.current.status !== 'denied') throw new Error('unreachable')
    expect(result.current.error).toMatch(/denied/i)
  })

  it('returns unsupported when navigator.geolocation is missing', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    const { result } = renderHook(() => useGeolocation())
    await waitFor(() => {
      expect(result.current.status).toBe('unsupported')
    })
  })
})
