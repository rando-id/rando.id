'use client'

// New-contact form. Map picker + GPS + Nominatim reverse-geocode +
// POST /v1/contacts. Falls back gracefully when geolocation or geocoding
// is unavailable — the user can always type a name and drag the pin.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Label, Paragraph, Text, XStack, YStack } from 'tamagui'
import { ApiError } from '@rando/api-client'
import { useGeolocation } from './use-geolocation'
import { MapPicker } from './MapPicker'
import { reverseGeocode } from './geocode'
import { validateNewContactDraft } from './helpers'
import { useCreateContact } from './hooks'

// Reasonable fallback if the user denies geolocation (downtown Los Angeles).
const FALLBACK_LAT = 34.0522
const FALLBACK_LNG = -118.2437

export function NewContactForm() {
  const router = useRouter()
  const geo = useGeolocation()
  const createMutation = useCreateContact()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [notes, setNotes] = useState('')
  const [pin, setPin] = useState<{ lat: number; lng: number }>({
    lat: FALLBACK_LAT,
    lng: FALLBACK_LNG,
  })
  const [locationName, setLocationName] = useState('')
  const [locationNameTouched, setLocationNameTouched] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = createMutation.isPending

  // Once the device returns coordinates, jump the pin to the user and
  // (if the user hasn't typed a name yet) reverse-geocode for a default.
  useEffect(() => {
    if (geo.status !== 'ready') return
    setPin({ lat: geo.lat, lng: geo.lng })
  }, [geo])

  // Reverse-geocode whenever the pin moves, unless the user has typed
  // their own location name (we don't want to overwrite their text).
  // Debounced via abort controller so rapid drags only fire one call.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (locationNameTouched) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const controller = new AbortController()
    debounceRef.current = setTimeout(async () => {
      setGeocoding(true)
      const result = await reverseGeocode(pin.lat, pin.lng, controller.signal)
      setGeocoding(false)
      if (result) setLocationName(result.displayName)
    }, 600)
    return () => {
      controller.abort()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [pin, locationNameTouched])

  async function handleSubmit() {
    setError(null)
    const validationError = validateNewContactDraft({ firstName, lastName, locationName })
    if (validationError) {
      setError(validationError)
      return
    }
    try {
      await createMutation.mutateAsync({
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        notes: notes.trim() || null,
        location: { lat: pin.lat, lng: pin.lng, name: locationName.trim() },
      })
      router.push('/contacts')
    } catch (e) {
      setError(e instanceof ApiError ? `API ${e.status}: ${e.message}` : String(e))
    }
  }

  return (
    <YStack p="$4" gap="$4" maxW={640}>
      <Text fontSize="$8" fontWeight="700">
        New contact
      </Text>

      <YStack gap="$2">
        <Label htmlFor="firstName">First name</Label>
        <Input
          id="firstName"
          value={firstName}
          onChangeText={setFirstName}
          placeholder="e.g. Jane"
        />
      </YStack>

      <YStack gap="$2">
        <Label htmlFor="lastName">Last name</Label>
        <Input id="lastName" value={lastName} onChangeText={setLastName} placeholder="(optional)" />
      </YStack>

      <YStack gap="$2">
        <XStack items="center" justify="space-between">
          <Label htmlFor="locationName">Where you met them</Label>
          {geocoding ? (
            <Text fontSize="$2" color="$colorPress">
              finding nearest place…
            </Text>
          ) : null}
        </XStack>
        <Input
          id="locationName"
          value={locationName}
          onChangeText={(v: string) => {
            setLocationName(v)
            setLocationNameTouched(true)
          }}
          placeholder="e.g. Wilson Park"
        />
        <Paragraph fontSize="$2" color="$colorPress">
          Drag the pin or tap the map to move it. Address fills in automatically.
        </Paragraph>
        <MapPicker lat={pin.lat} lng={pin.lng} onChange={setPin} />
        <XStack gap="$2" items="center">
          <Text fontSize="$2" color="$colorPress">
            {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
          </Text>
          {geo.status === 'ready' ? (
            <Button size="$2" onPress={() => setPin({ lat: geo.lat, lng: geo.lng })}>
              Use my location
            </Button>
          ) : geo.status === 'denied' ? (
            <Text fontSize="$2" color="$red10">
              Location permission denied
            </Text>
          ) : null}
        </XStack>
      </YStack>

      <YStack gap="$2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Input
          id="notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Baseball mom, knows my kid's coach"
        />
      </YStack>

      {error ? (
        <Text color="$red10" fontSize="$3">
          {error}
        </Text>
      ) : null}

      <XStack gap="$2">
        <Button onPress={() => router.back()} disabled={submitting}>
          Cancel
        </Button>
        <Button theme="accent" onPress={handleSubmit} disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
      </XStack>
    </YStack>
  )
}
