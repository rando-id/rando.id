import { useEffect, useMemo, useState } from 'react'
import { Button, Input, ScrollView, Select, Separator, Text, XStack, YStack } from 'tamagui'
import { type ContactListItem } from '@rando/api-client'
import { useGeolocation } from '../lib/use-geolocation'
import { useContacts, type ContactsFilter } from '../lib/hooks'

export interface ContactsScreenProps {
  /** Optional handler for the "+ New" button in the header. */
  onNew?: () => void
  /** Optional handler for tapping a contact row. */
  onOpen?: (id: string) => void
}

const SORT_OPTIONS: Array<{ value: NonNullable<ContactsFilter['sort']>; label: string }> = [
  { value: 'distance', label: 'Closest first' },
  { value: 'last_name', label: 'Last name' },
  { value: 'date_added', label: 'Recently added' },
  { value: 'date_updated', label: 'Recently updated' },
]

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

function ContactRow({ contact, onPress }: { contact: ContactListItem; onPress?: () => void }) {
  return (
    <XStack
      py="$3"
      px="$4"
      items="center"
      gap="$3"
      onPress={onPress}
      pressStyle={{ opacity: 0.6 }}
      cursor={onPress ? 'pointer' : undefined}
    >
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

export function ContactsScreen({ onNew, onOpen }: ContactsScreenProps = {}) {
  const geo = useGeolocation()
  const near = geo.status === 'ready' ? { lat: geo.lat, lng: geo.lng } : undefined

  const [draftQ, setDraftQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [sort, setSort] = useState<NonNullable<ContactsFilter['sort']> | undefined>(undefined)

  // 250ms debounce so each keystroke doesn't refire the query.
  useEffect(() => {
    if (draftQ === appliedQ) return
    const t = setTimeout(() => setAppliedQ(draftQ), 250)
    return () => clearTimeout(t)
  }, [draftQ, appliedQ])

  const filter = useMemo<ContactsFilter | undefined>(() => {
    const f: ContactsFilter = {}
    if (appliedQ.trim()) f.q = appliedQ.trim()
    if (sort) f.sort = sort
    return Object.keys(f).length ? f : undefined
  }, [appliedQ, sort])

  const {
    data: contacts,
    isLoading,
    error,
  } = useContacts(geo.status === 'pending' ? undefined : near, filter)

  const effectiveSort = sort ?? (near ? 'distance' : 'last_name')

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

        <XStack px="$3" pb="$3" gap="$2" items="center">
          <Input
            flex={1}
            value={draftQ}
            onChangeText={setDraftQ}
            placeholder="Search name or company"
          />
          <Select
            value={effectiveSort}
            onValueChange={(v) => setSort(v as NonNullable<ContactsFilter['sort']>)}
          >
            <Select.Trigger width={170}>
              <Select.Value placeholder="Sort" />
            </Select.Trigger>
            <Select.Content>
              <Select.Viewport>
                {SORT_OPTIONS.map((opt, i) => (
                  <Select.Item key={opt.value} value={opt.value} index={i}>
                    <Select.ItemText>{opt.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select>
        </XStack>

        {geo.status !== 'ready' ? (
          <Text px="$3" pb="$2" fontSize="$2" color="$colorPress">
            Location unavailable — distance sort falls back to last name.
          </Text>
        ) : null}

        {geo.status === 'pending' || isLoading || contacts == null ? (
          <YStack p="$4">
            <Text>Loading…</Text>
          </YStack>
        ) : error ? (
          <YStack p="$4">
            <Text color="$red10">Couldn&apos;t load contacts: {error.message}</Text>
          </YStack>
        ) : contacts.length === 0 ? (
          <YStack p="$4">
            <Text>
              {appliedQ.trim()
                ? `No contacts match "${appliedQ.trim()}".`
                : 'No contacts yet — tap "+ New" to add your first.'}
            </Text>
          </YStack>
        ) : (
          contacts.map((c, i) => (
            <YStack key={c.id}>
              <ContactRow contact={c} onPress={onOpen ? () => onOpen(c.id) : undefined} />
              {i < contacts.length - 1 ? <Separator /> : null}
            </YStack>
          ))
        )}
      </YStack>
    </ScrollView>
  )
}
