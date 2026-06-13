import { useEffect, useState } from 'react'
import { Button, ScrollView, Separator, Text, XStack, YStack } from 'tamagui'
import { listContacts, type ContactListItem } from '@rando/api-client'
import { useApiClient } from '../lib/client-api'
import { useGeolocation } from '../lib/use-geolocation'

export interface ContactsScreenProps {
  /** Optional handler for the "+ New" button in the header. */
  onNew?: () => void
}

function displayName(c: ContactListItem): string {
  const first = c.firstName?.trim()
  const last = c.lastName?.trim()
  if (first && last) return `${first} ${last}`
  if (first) return first
  if (last) return last
  return 'Unnamed'
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function ContactRow({ contact }: { contact: ContactListItem }) {
  return (
    <XStack py="$3" px="$4" items="center" gap="$3">
      <YStack flex={1}>
        <Text fontSize="$5" fontWeight="600">
          {displayName(contact)}
        </Text>
        <Text fontSize="$2" color="$colorPress">
          {contact.location ? contact.location.name : 'No location yet'}
        </Text>
      </YStack>
      {contact.location ? (
        <Text fontSize="$2" color="$colorPress">
          {formatDistance(contact.location.meters)}
        </Text>
      ) : null}
    </XStack>
  )
}

export function ContactsScreen({ onNew }: ContactsScreenProps = {}) {
  const api = useApiClient()
  const geo = useGeolocation()
  const [contacts, setContacts] = useState<ContactListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (geo.status === 'pending') return
    const near = geo.status === 'ready' ? { lat: geo.lat, lng: geo.lng } : {}
    setError(null)
    listContacts(api, near)
      .then(setContacts)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [api, geo])

  if (geo.status === 'pending' || contacts === null) {
    return (
      <YStack p="$4">
        <Text>Loading…</Text>
      </YStack>
    )
  }

  if (error) {
    return (
      <YStack p="$4">
        <Text color="$red10">Couldn&apos;t load contacts: {error}</Text>
      </YStack>
    )
  }

  return (
    <ScrollView flex={1}>
      <YStack flex={1}>
        {onNew ? (
          <XStack p="$3" justify="space-between" items="center">
            <Text fontSize="$6" fontWeight="700">
              Contacts
            </Text>
            <Button theme="accent" size="$3" onPress={onNew}>
              + New
            </Button>
          </XStack>
        ) : null}
        {geo.status !== 'ready' ? (
          <Text p="$3" fontSize="$2" color="$colorPress">
            Location unavailable — showing contacts alphabetically.
          </Text>
        ) : null}
        {contacts.length === 0 ? (
          <YStack p="$4">
            <Text>No contacts yet — tap &quot;+ New&quot; to add your first.</Text>
          </YStack>
        ) : (
          contacts.map((c, i) => (
            <YStack key={c.id}>
              <ContactRow contact={c} />
              {i < contacts.length - 1 ? <Separator /> : null}
            </YStack>
          ))
        )}
      </YStack>
    </ScrollView>
  )
}
