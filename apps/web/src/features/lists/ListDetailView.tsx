'use client'

// One list's detail page. Shows members, lets the user rename or delete
// the list, and remove members from it. Adding members is done from the
// contact detail page (the contact is the noun the user is acting on).

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button, Input, Text, XStack, YStack } from 'tamagui'
import { ApiError } from '@rando/api-client'
import { displayName } from '../contacts/helpers'
import { useDeleteList, useList, useRemoveListMember, useUpdateList } from '../contacts/hooks'

export interface ListDetailViewProps {
  id: string
}

export function ListDetailView({ id }: ListDetailViewProps) {
  const router = useRouter()
  const { data: list, isLoading, error: loadError } = useList(id)
  const updateMutation = useUpdateList(id)
  const deleteMutation = useDeleteList()
  const removeMember = useRemoveListMember(id)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (list && editingName === null) setEditingName(null)
  }, [list, editingName])

  async function saveName() {
    if (!list || editingName === null) return
    const name = editingName.trim()
    if (!name) {
      setError('Name cannot be empty.')
      return
    }
    if (name === list.name) {
      setEditingName(null)
      return
    }
    setError(null)
    try {
      await updateMutation.mutateAsync({ name })
      setEditingName(null)
    } catch (e) {
      setError(e instanceof ApiError ? `API ${e.status}: ${e.message}` : String(e))
    }
  }

  async function handleDelete() {
    if (!list) return
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Delete list "${list.name}"? Members stay; the list itself is removed.`)
    ) {
      return
    }
    setError(null)
    try {
      await deleteMutation.mutateAsync({ id })
      router.push('/lists')
    } catch (e) {
      setError(e instanceof ApiError ? `API ${e.status}: ${e.message}` : String(e))
    }
  }

  async function handleRemove(contactId: string) {
    setError(null)
    try {
      await removeMember.mutateAsync({ contactId })
    } catch (e) {
      setError(e instanceof ApiError ? `API ${e.status}: ${e.message}` : String(e))
    }
  }

  if (loadError) {
    return (
      <YStack p="$4" gap="$3">
        <Link href="/lists" style={{ textDecoration: 'none' }}>
          <Button size="$2">← Back</Button>
        </Link>
        <Text color="$red10">Couldn&apos;t load list: {loadError.message}</Text>
      </YStack>
    )
  }

  if (isLoading || !list) {
    return (
      <YStack p="$4">
        <Text>Loading…</Text>
      </YStack>
    )
  }

  const busy = updateMutation.isPending || deleteMutation.isPending || removeMember.isPending

  return (
    <YStack p="$4" gap="$4" maxW={640}>
      <XStack items="center" justify="space-between">
        <Link href="/lists" style={{ textDecoration: 'none' }}>
          <Button size="$2">← Back</Button>
        </Link>
        <Button size="$2" theme="red" onPress={handleDelete} disabled={busy}>
          Delete list
        </Button>
      </XStack>

      {editingName !== null ? (
        <XStack gap="$2">
          <Input
            flex={1}
            value={editingName}
            onChangeText={setEditingName}
            placeholder="List name"
          />
          <Button onPress={() => setEditingName(null)} disabled={busy}>
            Cancel
          </Button>
          <Button theme="accent" onPress={saveName} disabled={busy}>
            Save
          </Button>
        </XStack>
      ) : (
        <XStack items="center" justify="space-between">
          <Text fontSize="$8" fontWeight="700">
            {list.name}
          </Text>
          <Button size="$2" onPress={() => setEditingName(list.name)}>
            Rename
          </Button>
        </XStack>
      )}

      {error ? (
        <Text fontSize="$2" color="$red10">
          {error}
        </Text>
      ) : null}

      <YStack gap="$2">
        <Text fontSize="$3" color="$colorPress">
          {list.members.length} contact{list.members.length === 1 ? '' : 's'}
        </Text>
        {list.members.length === 0 ? (
          <Text fontSize="$3" color="$colorPress">
            Nobody&apos;s on this list yet. Add contacts from their detail page.
          </Text>
        ) : (
          list.members.map((m) => (
            <XStack
              key={m.id}
              py="$3"
              px="$4"
              gap="$3"
              items="center"
              borderWidth={1}
              borderColor="$borderColor"
              rounded="$3"
            >
              <Link
                href={`/contacts/${m.id}`}
                style={{ textDecoration: 'none', color: 'inherit', flex: 1 }}
              >
                <YStack>
                  <Text fontSize="$5" fontWeight="600">
                    {m.favorite ? '★ ' : ''}
                    {displayName(m)}
                  </Text>
                  <Text fontSize="$2" color="$colorPress">
                    {m.location ? m.location.name : 'No location yet'}
                  </Text>
                </YStack>
              </Link>
              <Button size="$2" onPress={() => handleRemove(m.id)} disabled={busy}>
                Remove
              </Button>
            </XStack>
          ))
        )}
      </YStack>
    </YStack>
  )
}
