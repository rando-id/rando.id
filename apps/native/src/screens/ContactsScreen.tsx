import { Button, ScrollView, Separator, Text, XStack, YStack } from 'tamagui'
import { type ContactListItem } from '@rando/api-client'
import { useGeolocation } from '../lib/use-geolocation'
import { useContacts } from '../lib/hooks'

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
          {contact.favorite ? '★ ' : ''}
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
  const geo = useGeolocation()
  const near = geo.status === 'ready' ? { lat: geo.lat, lng: geo.lng } : undefined
  const {
    data: contacts,
    isLoading,
    error,
  } = useContacts(geo.status === 'pending' ? undefined : near)

  if (geo.status === 'pending' || isLoading || contacts == null) {
    return (
      <YStack p="$4">
        <Text>Loading…</Text>
      </YStack>
    )
  }

  if (error) {
    return (
      <YStack p="$4">
        <Text color="$red10">Couldn&apos;t load contacts: {error.message}</Text>
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
