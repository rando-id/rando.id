// Native parity for `apps/web/src/features/contacts/NewContactForm.tsx`.
// No map picker yet — react-native-maps requires a custom dev client
// that the Expo Go workflow doesn't ship. v1 captures GPS via
// expo-location and lets the user override the name. Map picker is a
// follow-up.

import { useEffect, useState } from 'react'
import * as Location from 'expo-location'
import { Button, Input, Label, Paragraph, Text, XStack, YStack } from 'tamagui'
import { ApiError } from '@rando/api-client'
import { osmAdapter } from '@rando/maps'
import { useCreateContact } from '../lib/hooks'

const FALLBACK_LAT = 34.0522
const FALLBACK_LNG = -118.2437

export interface AddContactScreenProps {
  /** Called after a successful create or when the user taps Cancel. */
  onDone: () => void
}

export function AddContactScreen({ onDone }: AddContactScreenProps) {
  const createMutation = useCreateContact()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [notes, setNotes] = useState('')
  const [lat, setLat] = useState(FALLBACK_LAT)
  const [lng, setLng] = useState(FALLBACK_LNG)
  const [locationName, setLocationName] = useState('')
  const [locationNameTouched, setLocationNameTouched] = useState(false)
  const [locating, setLocating] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const submitting = createMutation.isPending

  // Capture GPS on mount. expo-location asks for permission and resolves
  // with the current position; on denial we keep the fallback and let
  // the user proceed manually.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') {
          if (!cancelled) setLocating(false)
          return
        }
        const pos = await Location.getCurrentPositionAsync({})
        if (cancelled) return
        setLat(pos.coords.latitude)
        setLng(pos.coords.longitude)
        setLocating(false)
        if (!locationNameTouched) {
          const result = await osmAdapter.reverseGeocode({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          })
          if (!cancelled && result) setLocationName(result.name)
        }
      } catch {
        if (!cancelled) setLocating(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // We only run this once on mount; subsequent name auto-fills happen
    // only via the "Use my location" button which calls reverseGeocode
    // directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshLocation() {
    setLocating(true)
    setError(null)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        setError('Location permission denied.')
        return
      }
      const pos = await Location.getCurrentPositionAsync({})
      setLat(pos.coords.latitude)
      setLng(pos.coords.longitude)
      if (!locationNameTouched) {
        const result = await osmAdapter.reverseGeocode({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        })
        if (result) setLocationName(result.name)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLocating(false)
    }
  }

  async function handleSubmit() {
    setError(null)
    if (!firstName.trim() && !lastName.trim()) {
      setError('Add at least a first or last name.')
      return
    }
    if (!locationName.trim()) {
      setError('Give the location a name.')
      return
    }
    try {
      await createMutation.mutateAsync({
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        notes: notes.trim() || null,
        location: { lat, lng, name: locationName.trim() },
      })
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? `API ${e.status}: ${e.message}` : String(e))
    }
  }

  return (
    <YStack p="$4" gap="$4" flex={1}>
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
        <Label htmlFor="locationName">Where you met them</Label>
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
          {locating ? 'Getting your current location…' : `${lat.toFixed(5)}, ${lng.toFixed(5)}`}
        </Paragraph>
        <Button size="$2" onPress={refreshLocation} disabled={locating || submitting}>
          Use my current location
        </Button>
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

      <XStack gap="$2" mt="auto">
        <Button onPress={onDone} disabled={submitting} flex={1}>
          Cancel
        </Button>
        <Button theme="accent" onPress={handleSubmit} disabled={submitting} flex={1}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
      </XStack>
    </YStack>
  )
}
