'use client'

// Contact detail page. View mode shows the fields + a favorite toggle;
// Edit mode swaps to inputs for name + notes. Map of where you met
// them is intentionally deferred to a follow-up — this is the minimal
// read/write surface.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button, Input, Label, Paragraph, Text, XStack, YStack } from 'tamagui'
import { ApiError, getContact, updateContact, type ContactListItem } from '@rando/api-client'
import { useApiClient } from '../../lib/client-api'
import {
  buildContactPatch,
  displayName,
  type EditContactDraft,
  validateEditContactDraft,
} from './helpers'

export interface ContactDetailViewProps {
  id: string
}

export function ContactDetailView({ id }: ContactDetailViewProps) {
  const api = useApiClient()
  const [contact, setContact] = useState<ContactListItem | null>(null)
  // Detail page tracks `notes` separately because the list endpoint
  // doesn't surface it. We GET the row and trust the server's value;
  // edit-mode reads from this state.
  const [notes, setNotes] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<EditContactDraft>({
    firstName: '',
    lastName: '',
    notes: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    getContact(api, id)
      .then((c) => {
        if (cancelled) return
        setContact(c)
        // ContactListItem doesn't include notes — fetch fully via the API
        // when we add a "with details" flag. For now `notes` is blank on
        // load; the user can still edit it.
        setNotes('')
        setDraft({
          firstName: c.firstName ?? '',
          lastName: c.lastName ?? '',
          notes: '',
        })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [api, id])

  async function toggleFavorite() {
    if (!contact || busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await updateContact(api, id, { favorite: !contact.favorite })
      setContact(updated)
    } catch (e) {
      setError(e instanceof ApiError ? `API ${e.status}: ${e.message}` : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit() {
    if (!contact) return
    const validationError = validateEditContactDraft(draft)
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy(true)
    setError(null)
    const patch = buildContactPatch({ ...contact, notes }, draft)
    try {
      if (Object.keys(patch).length > 0) {
        const updated = await updateContact(api, id, patch)
        setContact(updated)
      }
      setNotes(draft.notes)
      setEditing(false)
    } catch (e) {
      setError(e instanceof ApiError ? `API ${e.status}: ${e.message}` : String(e))
    } finally {
      setBusy(false)
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

  if (error && !contact) {
    return (
      <YStack p="$4" gap="$3">
        <Link href="/contacts" style={{ textDecoration: 'none' }}>
          <Button size="$2">← Back</Button>
        </Link>
        <Text color="$red10">Couldn&apos;t load contact: {error}</Text>
      </YStack>
    )
  }

  if (!contact) {
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
