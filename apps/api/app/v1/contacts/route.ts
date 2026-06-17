// /v1/contacts — list + create, served from one ts-rest handler.
// Request/response shapes come from the contract in @rando/api-client;
// drift between this file and the spec is impossible at the type level.

import { createNextHandler } from '@ts-rest/serverless/next'
import { contract } from '@rando/api-client'
import { createContactWithLocation, getContactsNearby } from '@rando/db'
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

const handler = createNextHandler(
  { listContacts: contract.listContacts, createContact: contract.createContact },
  {
    listContacts: async ({ query }) => {
      try {
        const user = await requireCurrentUser()
        const near = parseNear(query.near)
        const rows = await getContactsNearby(getDb(), user.id, near, {
          favorites: query.favorites === 'true',
          listId: query.list,
          q: query.q,
          sort: query.sort,
        })
        return {
          status: 200 as const,
          body: rows.map((r) => ({
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
          })),
        }
      } catch (e) {
        if (e instanceof Response) {
          return { status: 401 as const, body: { error: 'unauthorized' } }
        }
        throw e
      }
    },

    createContact: async ({ body }) => {
      try {
        const user = await requireCurrentUser()
        // Require at least one of firstName/lastName/company so the
        // contact has *something* to display in the list.
        if (!body.firstName && !body.lastName && !body.company) {
          return {
            status: 400 as const,
            body: { error: 'one of firstName, lastName, or company is required' },
          }
        }

        const db = getDb()
        const created = await createContactWithLocation(db, {
          ownerUserId: user.id,
          firstName: body.firstName ?? null,
          lastName: body.lastName ?? null,
          company: body.company ?? null,
          notes: body.notes ?? null,
          favorite: body.favorite,
          location: body.location,
          interaction: body.interaction
            ? {
                metAt: body.interaction.metAt ? new Date(body.interaction.metAt) : undefined,
                notes: body.interaction.notes ?? null,
              }
            : undefined,
        })

        // Pull the fresh row back through the same shape the list endpoint
        // returns so the client can stitch it into its local list.
        const rows = await getContactsNearby(db, user.id, {
          lat: body.location.lat,
          lng: body.location.lng,
        })
        const fresh = rows.find((r) => r.id === created.contactId)
        if (!fresh) {
          return { status: 500 as const, body: { error: 'created but lookup failed' } }
        }

        return {
          status: 201 as const,
          body: {
            contact: {
              id: fresh.id,
              firstName: fresh.first_name,
              lastName: fresh.last_name,
              avatarKind: fresh.avatar_kind,
              avatarValue: fresh.avatar_value,
              favorite: fresh.favorite,
              promoted: fresh.promoted,
              location:
                fresh.location_id &&
                fresh.location_name &&
                fresh.lat != null &&
                fresh.lng != null &&
                fresh.meters != null
                  ? {
                      id: fresh.location_id,
                      name: fresh.location_name,
                      lat: fresh.lat,
                      lng: fresh.lng,
                      meters: fresh.meters,
                    }
                  : null,
            },
            locationReused: created.locationReused,
          },
        }
      } catch (e) {
        if (e instanceof Response) {
          return { status: 401 as const, body: { error: 'unauthorized' } }
        }
        throw e
      }
    },
  },
  { handlerType: 'app-router' },
)

export { handler as GET, handler as POST }
