// /v1/contacts/:id — get + patch, served from one ts-rest handler.
// Both methods share the row-mapping helper; the path param `id` flows
// from the contract via `params.id`.

import { createNextHandler } from '@ts-rest/serverless/next'
import { contract } from '@rando/api-client'
import { getContactById, updateContact } from '@rando/db'
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

function mapRow(r: NonNullable<Awaited<ReturnType<typeof getContactById>>>) {
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
  { getContact: contract.getContact, updateContact: contract.updateContact },
  {
    getContact: async ({ params, query }) => {
      try {
        const user = await requireCurrentUser()
        const near = parseNear(query.near)
        const row = await getContactById(getDb(), user.id, params.id, near)
        if (!row) return { status: 404 as const, body: { error: 'not found' } }
        return { status: 200 as const, body: mapRow(row) }
      } catch (e) {
        if (e instanceof Response) {
          return { status: 404 as const, body: { error: 'unauthorized' } }
        }
        throw e
      }
    },

    updateContact: async ({ params, query, body }) => {
      try {
        const user = await requireCurrentUser()
        const db = getDb()
        const affected = await updateContact(db, user.id, params.id, body)
        if (affected === 0) {
          // Either not-found, not-owned, or empty patch. Re-check existence
          // explicitly so we don't 404 on an empty patch against a real
          // contact (we just return the unchanged row in that case).
          const existing = await getContactById(db, user.id, params.id, null)
          if (!existing) return { status: 404 as const, body: { error: 'not found' } }
        }
        const near = parseNear(query.near)
        const fresh = await getContactById(db, user.id, params.id, near)
        if (!fresh) return { status: 404 as const, body: { error: 'not found' } }
        return { status: 200 as const, body: mapRow(fresh) }
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

export { handler as GET, handler as PATCH }
