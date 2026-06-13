'use client'

// Contact detail page. View mode shows the fields + a favorite toggle;
// Edit mode swaps to inputs for name + notes. Read/write both go through
// the TanStack Query hooks layer so list and detail views stay in sync.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button, Input, Label, Paragraph, Text, XStack, YStack } from 'tamagui'
import { ApiError } from '@rando/api-client'
import {
  buildContactPatch,
  displayName,
  type EditContactDraft,
  validateEditContactDraft,
} from './helpers'
import { useContact, useUpdateContact } from './hooks'

export interface ContactDetailViewProps {
  id: string
}

export function ContactDetailView({ id }: ContactDetailViewProps) {
  const { data: contact, isLoading, error: loadError } = useContact(id)
  const updateMutation = useUpdateContact(id)
  // Detail page tracks `notes` separately because the list endpoint
  // doesn't surface it. When we add a "with details" flag to the API,
  // the hook can carry it. For now `notes` starts blank on load.
  const [notes, setNotes] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<EditContactDraft>({
    firstName: '',
    lastName: '',
    notes: '',
  })
  const [error, setError] = useState<string | null>(null)
  const busy = updateMutation.isPending

  // Seed the edit-draft when the contact loads or changes.
  useEffect(() => {
    if (!contact) return
    setDraft({
      firstName: contact.firstName ?? '',
      lastName: contact.lastName ?? '',
      notes,
    })
  }, [contact, notes])

  async function toggleFavorite() {
    if (!contact || busy) return
    setError(null)
    try {
      await updateMutation.mutateAsync({ favorite: !contact.favorite })
    } catch (e) {
      setError(e instanceof ApiError ? `API ${e.status}: ${e.message}` : String(e))
    }
  }

  async function saveEdit() {
    if (!contact) return
    const validationError = validateEditContactDraft(draft)
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    const patch = buildContactPatch({ ...contact, notes }, draft)
    try {
      if (Object.keys(patch).length > 0) {
        await updateMutation.mutateAsync(patch)
      }
      setNotes(draft.notes)
      setEditing(false)
    } catch (e) {
      setError(e instanceof ApiError ? `API ${e.status}: ${e.message}` : String(e))
    }
  }

  function cancelEdit() {
    if (!contact) return
    setDraft({
      firstName: contact.firstName ?? '',
      lastName: contact.lastName ?? '',
      notes,
    })
    setEditing(false)
    setError(null)
  }

  if (loadError) {
    return (
      <YStack p="$4" gap="$3">
        <Link href="/contacts" style={{ textDecoration: 'none' }}>
          <Button size="$2">← Back</Button>
        </Link>
        <Text color="$red10">Couldn&apos;t load contact: {loadError.message}</Text>
      </YStack>
    )
  }

  if (isLoading || !contact) {
    return (
      <YStack p="$4">
        <Text>Loading…</Text>
      </YStack>
    )
  }

  return (
    <YStack p="$4" gap="$4" maxW={640}>
      <XStack items="center" justify="space-between">
        <Link href="/contacts" style={{ textDecoration: 'none' }}>
          <Button size="$2">← Back</Button>
        </Link>
        {!editing ? (
          <XStack gap="$2">
            <Button size="$2" onPress={toggleFavorite} disabled={busy}>
              {contact.favorite ? '★ Unfavorite' : '☆ Favorite'}
            </Button>
            <Button size="$2" theme="accent" onPress={() => setEditing(true)} disabled={busy}>
              Edit
            </Button>
          </XStack>
        ) : null}
      </XStack>

      {editing ? (
        <YStack gap="$3">
          <YStack gap="$2">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              value={draft.firstName}
              onChangeText={(v: string) => setDraft({ ...draft, firstName: v })}
            />
          </YStack>
          <YStack gap="$2">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              value={draft.lastName}
              onChangeText={(v: string) => setDraft({ ...draft, lastName: v })}
            />
          </YStack>
          <YStack gap="$2">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              value={draft.notes}
              onChangeText={(v: string) => setDraft({ ...draft, notes: v })}
              placeholder="What do you want to remember?"
            />
          </YStack>
          {error ? (
            <Text color="$red10" fontSize="$3">
              {error}
            </Text>
          ) : null}
          <XStack gap="$2">
            <Button onPress={cancelEdit} disabled={busy}>
              Cancel
            </Button>
            <Button theme="accent" onPress={saveEdit} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </XStack>
        </YStack>
      ) : (
        <YStack gap="$3">
          <Text fontSize="$8" fontWeight="700">
            {displayName(contact)}
          </Text>
          {contact.location ? (
            <Paragraph color="$colorPress">
              Met at <Text fontWeight="600">{contact.location.name}</Text>
            </Paragraph>
          ) : (
            <Paragraph color="$colorPress">No location recorded.</Paragraph>
          )}
          {notes ? <Paragraph>{notes}</Paragraph> : null}
          {error ? (
            <Text color="$red10" fontSize="$3">
              {error}
            </Text>
          ) : null}
        </YStack>
      )}
    </YStack>
  )
}
