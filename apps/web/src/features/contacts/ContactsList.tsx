'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button, Text, XStack, YStack } from 'tamagui'
import { listContacts, type ContactListItem } from '@rando/api-client'
import { useApiClient } from '../../lib/client-api'
import { useGeolocation } from './use-geolocation'
import { displayName, formatDistance } from './helpers'

function ContactRow({ contact }: { contact: ContactListItem }) {
  return (
    <XStack
      py="$3"
      px="$4"
      borderBottomWidth={1}
      borderBottomColor="$borderColor"
      items="center"
      gap="$3"
    >
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

export function ContactsList() {
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
    <YStack flex={1}>
      <XStack p="$3" justify="space-between" items="center">
        <Text fontSize="$6" fontWeight="700">
          Contacts
        </Text>
        <Link href="/contacts/new" style={{ textDecoration: 'none' }}>
          <Button theme="accent" size="$3">
            + New
          </Button>
        </Link>
      </XStack>
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
        contacts.map((c) => <ContactRow key={c.id} contact={c} />)
      )}
    </YStack>
  )
}
