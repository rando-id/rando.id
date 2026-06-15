// /v1/lists/:id — get-with-members + rename + delete, one ts-rest handler.

import { createNextHandler } from '@ts-rest/serverless/next'
import { contract } from '@rando/api-client'
import { deleteList, getContactsNearby, getListById, updateListName } from '@rando/db'
import { getDb } from '@/lib/db'
import { requireCurrentUser } from '@/lib/current-user'

function parseNear(value: string | undefined): { lat: number; lng: number } | null {
  if (!value) return null
  const [latStr, lngStr] = value.split(',')
  const lat = parseFloat(latStr ?? '')
  const lng = parseFloat(lngStr ?? '')
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

function mapMember(r: Awaited<ReturnType<typeof getContactsNearby>>[number]) {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    avatarKind: r.avatar_kind,
    avatarValue: r.avatar_value,
    favorite: r.favorite,
    promoted: r.promoted,
    location:
      r.location_id && r.location_name && r.lat != null && r.lng != null && r.meters != null
        ? {
            id: r.location_id,
            name: r.location_name,
            lat: r.lat,
            lng: r.lng,
            meters: r.meters,
          }
        : null,
  }
}

const handler = createNextHandler(
  {
    getList: contract.getList,
    updateList: contract.updateList,
    deleteList: contract.deleteList,
  },
  {
    getList: async ({ params, query }) => {
      try {
        const user = await requireCurrentUser()
        const db = getDb()
        const list = await getListById(db, user.id, params.id)
        if (!list) return { status: 404 as const, body: { error: 'not found' } }

        const near = parseNear(query.near)
        const memberRows = await getContactsNearby(db, user.id, near, { listId: params.id })

        return {
          status: 200 as const,
          body: {
            id: list.id,
            name: list.name,
            kind: list.kind,
            coverImage: list.coverImage,
            createdAt: list.createdAt.toISOString(),
            updatedAt: list.updatedAt.toISOString(),
            memberCount: memberRows.length,
            members: memberRows.map(mapMember),
          },
        }
      } catch (e) {
        if (e instanceof Response) {
          return { status: 404 as const, body: { error: 'unauthorized' } }
        }
        throw e
      }
    },

    updateList: async ({ params, body }) => {
      try {
        const user = await requireCurrentUser()
        const db = getDb()
        const affected = await updateListName(db, user.id, params.id, body.name)
        if (affected === 0) {
          return { status: 404 as const, body: { error: 'not found' } }
        }
        const fresh = await getListById(db, user.id, params.id)
        if (!fresh) return { status: 404 as const, body: { error: 'not found' } }
        return {
          status: 200 as const,
          body: {
            id: fresh.id,
            name: fresh.name,
            kind: fresh.kind,
            coverImage: fresh.coverImage,
            createdAt: fresh.createdAt.toISOString(),
            updatedAt: fresh.updatedAt.toISOString(),
            memberCount: fresh.memberCount ?? 0,
          },
        }
      } catch (e) {
        if (e instanceof Response) {
          return { status: 404 as const, body: { error: 'unauthorized' } }
        }
        throw e
      }
    },

    deleteList: async ({ params }) => {
      try {
        const user = await requireCurrentUser()
        const affected = await deleteList(getDb(), user.id, params.id)
        if (affected === 0) {
          return { status: 404 as const, body: { error: 'not found' } }
        }
        return { status: 200 as const, body: { ok: true as const } }
      } catch (e) {
        if (e instanceof Response) {
          return { status: 404 as const, body: { error: 'unauthorized' } }
        }
        throw e
      }
    },
  },
  { handlerType: 'app-router' },
)

export { handler as GET, handler as PATCH, handler as DELETE }
