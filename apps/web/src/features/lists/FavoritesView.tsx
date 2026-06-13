'use client'

// /favorites — virtual "list" of contacts where favorite=true.
// Mirrors the shape of ContactsList but goes through useFavorites().

import Link from 'next/link'
import { Button, Text, XStack, YStack } from 'tamagui'
import { type ContactListItem } from '@rando/api-client'
import { useGeolocation } from '../contacts/use-geolocation'
import { displayName, formatDistance } from '../contacts/helpers'
import { useFavorites } from '../contacts/hooks'

function ContactRow({ contact }: { contact: ContactListItem }) {
  return (
    <Link href={`/contacts/${contact.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <XStack
        py="$3"
        px="$4"
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
        items="center"
        gap="$3"
        hoverStyle={{ bg: '$backgroundHover' }}
        cursor="pointer"
      >
        <YStack flex={1}>
          <Text fontSize="$5" fontWeight="600">
            ★ {displayName(contact)}
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
    </Link>
  )
}

export function FavoritesView() {
  const geo = useGeolocation()
  const near = geo.status === 'ready' ? { lat: geo.lat, lng: geo.lng } : undefined
  const {
    data: contacts,
    isLoading,
    error,
  } = useFavorites(geo.status === 'pending' ? undefined : near)

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
        <Text color="$red10">Couldn&apos;t load favorites: {error.message}</Text>
      </YStack>
    )
  }

  return (
    <YStack flex={1}>
      <XStack p="$3" justify="space-between" items="center">
        <Text fontSize="$6" fontWeight="700">
          ★ Favorites
        </Text>
        <Link href="/lists" style={{ textDecoration: 'none' }}>
          <Button size="$2">← Back to lists</Button>
        </Link>
      </XStack>
      {contacts.length === 0 ? (
        <YStack p="$4">
          <Text>No favorites yet. Tap the ☆ on a contact&apos;s page to add them.</Text>
        </YStack>
      ) : (
        contacts.map((c) => <ContactRow key={c.id} contact={c} />)
      )}
    </YStack>
  )
}
