'use client'

// Lists index page. Shows a fixed "Favorites" tile (favorite=true filter
// on contacts — not a row in the lists table) at the top, then the
// user's custom lists, then a "+ New" button.

import { useState } from 'react'
import Link from 'next/link'
import { Button, Input, Text, XStack, YStack } from 'tamagui'
import { ApiError } from '@rando/api-client'
import { useCreateList, useFavorites, useLists } from '../contacts/hooks'

export function ListsIndex() {
  const lists = useLists()
  const favorites = useFavorites()
  const createMutation = useCreateList()
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    setError(null)
    const name = newName.trim()
    if (!name) {
      setError('Give the list a name.')
      return
    }
    try {
      await createMutation.mutateAsync({ name })
      setNewName('')
    } catch (e) {
      setError(e instanceof ApiError ? `API ${e.status}: ${e.message}` : String(e))
    }
  }

  return (
    <YStack p="$4" gap="$4" maxW={640}>
      <XStack items="center" justify="space-between">
        <Text fontSize="$8" fontWeight="700">
          Lists
        </Text>
      </XStack>

      <Link href="/favorites" style={{ textDecoration: 'none', color: 'inherit' }}>
        <XStack
          py="$3"
          px="$4"
          gap="$3"
          items="center"
          borderWidth={1}
          borderColor="$borderColor"
          rounded="$3"
          hoverStyle={{ bg: '$backgroundHover' }}
          cursor="pointer"
        >
          <Text fontSize="$5">★</Text>
          <YStack flex={1}>
            <Text fontSize="$5" fontWeight="600">
              Favorites
            </Text>
            <Text fontSize="$2" color="$colorPress">
              {favorites.data
                ? `${favorites.data.length} contact${favorites.data.length === 1 ? '' : 's'}`
                : 'Loading…'}
            </Text>
          </YStack>
        </XStack>
      </Link>

      <YStack gap="$2">
        <Text fontSize="$5" fontWeight="600">
          Custom lists
        </Text>
        {lists.isLoading ? (
          <Text>Loading…</Text>
        ) : lists.error ? (
          <Text color="$red10">Couldn&apos;t load lists: {lists.error.message}</Text>
        ) : !lists.data || lists.data.length === 0 ? (
          <Text fontSize="$3" color="$colorPress">
            No lists yet — create one below.
          </Text>
        ) : (
          lists.data.map((list) => (
            <Link
              key={list.id}
              href={`/lists/${list.id}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <XStack
                py="$3"
                px="$4"
                borderWidth={1}
                borderColor="$borderColor"
                rounded="$3"
                items="center"
                gap="$3"
                hoverStyle={{ bg: '$backgroundHover' }}
                cursor="pointer"
              >
                <YStack flex={1}>
                  <Text fontSize="$5" fontWeight="600">
                    {list.name}
                  </Text>
                  <Text fontSize="$2" color="$colorPress">
                    {list.memberCount} contact{list.memberCount === 1 ? '' : 's'}
                  </Text>
                </YStack>
              </XStack>
            </Link>
          ))
        )}
      </YStack>

      <YStack gap="$2">
        <Text fontSize="$3" fontWeight="600">
          New list
        </Text>
        <XStack gap="$2">
          <Input
            flex={1}
            value={newName}
            onChangeText={setNewName}
            placeholder="e.g. School pickup"
          />
          <Button theme="accent" onPress={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </XStack>
        {error ? (
          <Text fontSize="$2" color="$red10">
            {error}
          </Text>
        ) : null}
      </YStack>
    </YStack>
  )
}
