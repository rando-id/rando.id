// Native parity for apps/web/src/features/contacts/ContactDetailView.tsx.
// Goes through the same TanStack Query hooks so updates here reflect
// instantly back in the list. No map in detail v1 (matches web).

import { useEffect, useState } from 'react'
import { Button, Input, Label, Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui'
import { ApiError } from '@rando/api-client'
import { useContact, useUpdateContact } from '../lib/hooks'

export interface ContactDetailScreenProps {
  id: string
  /** Called when the user taps Back. */
  onDone: () => void
}

interface EditDraft {
  firstName: string
  lastName: string
  notes: string
}

function validate(draft: EditDraft): string | null {
  if (!draft.firstName.trim() && !draft.lastName.trim()) {
    return 'Add at least a first or last name.'
  }
  return null
}

export function ContactDetailScreen({ id, onDone }: ContactDetailScreenProps) {
  const { data: contact, isLoading, error: loadError } = useContact(id)
  const updateMutation = useUpdateContact(id)
  const [notes, setNotes] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<EditDraft>({
    firstName: '',
    lastName: '',
    notes: '',
  })
  const [error, setError] = useState<string | null>(null)
  const busy = updateMutation.isPending

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
    const v = validate(draft)
    if (v) {
      setError(v)
      return
    }
    setError(null)
    const patch: {
      firstName?: string | null
      lastName?: string | null
      notes?: string | null
    } = {}
    const trim = (s: string) => (s.trim() ? s.trim() : null)
    if (trim(draft.firstName) !== (contact.firstName ?? null))
      patch.firstName = trim(draft.firstName)
    if (trim(draft.lastName) !== (contact.lastName ?? null)) patch.lastName = trim(draft.lastName)
    if (trim(draft.notes) !== (notes || null)) patch.notes = trim(draft.notes)
    try {
      if (Object.keys(patch).length > 0) await updateMutation.mutateAsync(patch)
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
        <Button size="$2" onPress={onDone}>
          ← Back
        </Button>
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

  const displayName =
    [contact.firstName, contact.lastName].filter((s) => s?.trim()).join(' ') || 'Unnamed'

  return (
    <ScrollView flex={1}>
      <YStack p="$4" gap="$4">
        <XStack items="center" justify="space-between">
          <Button size="$2" onPress={onDone}>
            ← Back
          </Button>
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
              <Button onPress={cancelEdit} disabled={busy} flex={1}>
                Cancel
              </Button>
              <Button theme="accent" onPress={saveEdit} disabled={busy} flex={1}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </XStack>
          </YStack>
        ) : (
          <YStack gap="$3">
            <Text fontSize="$8" fontWeight="700">
              {displayName}
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
    </ScrollView>
  )
}
