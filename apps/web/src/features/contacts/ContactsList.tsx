'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Input, Select, Text, XStack, YStack } from 'tamagui'
import { type ContactListItem } from '@rando/api-client'
import { useGeolocation } from './use-geolocation'
import { displayName, formatDistance } from './helpers'
import { useContacts, type ContactsFilter } from './hooks'

const SORT_OPTIONS: Array<{ value: NonNullable<ContactsFilter['sort']>; label: string }> = [
  { value: 'distance', label: 'Closest first' },
  { value: 'last_name', label: 'Last name' },
  { value: 'date_added', label: 'Recently added' },
  { value: 'date_updated', label: 'Recently updated' },
]

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
    </Link>
  )
}

export function ContactsList() {
  const router = useRouter()
  const params = useSearchParams()
  const geo = useGeolocation()
  const near = geo.status === 'ready' ? { lat: geo.lat, lng: geo.lng } : undefined

  const urlQ = params.get('q') ?? ''
  const urlSort = params.get('sort')
  const sort: ContactsFilter['sort'] =
    urlSort === 'distance' ||
    urlSort === 'last_name' ||
    urlSort === 'date_added' ||
    urlSort === 'date_updated'
      ? urlSort
      : undefined

  // Local input mirror so typing stays responsive; pushes to the URL on a
  // debounce so the back/forward stack doesn't get spammed with one entry
  // per keystroke.
  const [draftQ, setDraftQ] = useState(urlQ)
  useEffect(() => {
    setDraftQ(urlQ)
  }, [urlQ])

  useEffect(() => {
    if (draftQ === urlQ) return
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString())
      if (draftQ.trim()) next.set('q', draftQ.trim())
      else next.delete('q')
      router.replace(next.toString() ? `?${next}` : '?')
    }, 250)
    return () => clearTimeout(t)
  }, [draftQ, urlQ, params, router])

  function setSort(next: ContactsFilter['sort'] | undefined) {
    const p = new URLSearchParams(params.toString())
    if (next) p.set('sort', next)
    else p.delete('sort')
    router.replace(p.toString() ? `?${p}` : '?')
  }

  const filter = useMemo<ContactsFilter | undefined>(() => {
    const f: ContactsFilter = {}
    if (urlQ.trim()) f.q = urlQ.trim()
    if (sort) f.sort = sort
    return Object.keys(f).length ? f : undefined
  }, [urlQ, sort])

  const {
    data: contacts,
    isLoading,
    error,
  } = useContacts(geo.status === 'pending' ? undefined : near, filter)

  const effectiveSort = sort ?? (near ? 'distance' : 'last_name')

  return (
    <YStack flex={1}>
      <XStack p="$3" justify="space-between" items="center">
        <Text fontSize="$6" fontWeight="700">
          Contacts
        </Text>
        <XStack gap="$2">
          <Link href="/lists" style={{ textDecoration: 'none' }}>
            <Button size="$3">Lists</Button>
          </Link>
          <Link href="/contacts/new" style={{ textDecoration: 'none' }}>
            <Button theme="accent" size="$3">
              + New
            </Button>
          </Link>
        </XStack>
      </XStack>

      <XStack px="$3" pb="$3" gap="$2" items="center">
        <Input
          flex={1}
          value={draftQ}
          onChangeText={setDraftQ}
          placeholder="Search name or company"
          aria-label="Search contacts"
        />
        <Select value={effectiveSort} onValueChange={(v) => setSort(v as ContactsFilter['sort'])}>
          <Select.Trigger width={180} aria-label="Sort contacts">
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
            {urlQ.trim()
              ? `No contacts match "${urlQ.trim()}".`
              : 'No contacts yet — tap "+ New" to add your first.'}
          </Text>
        </YStack>
      ) : (
        contacts.map((c) => <ContactRow key={c.id} contact={c} />)
      )}
    </YStack>
  )
}
