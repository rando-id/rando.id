import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ContactListItem, CreateContactResult } from '@rando/api-client'
import { createContactWithLocation, getContactsNearby } from '@rando/db'
import { getDb } from '@/lib/db'
import { requireCurrentUser } from '@/lib/current-user'

function parseNear(value: string | null): { lat: number; lng: number } | null {
  if (!value) return null
  const [latStr, lngStr] = value.split(',')
  const lat = parseFloat(latStr ?? '')
  const lng = parseFloat(lngStr ?? '')
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

export async function GET(req: Request) {
  try {
    const user = await requireCurrentUser()
    const url = new URL(req.url)
    const near = parseNear(url.searchParams.get('near'))

    const rows = await getContactsNearby(getDb(), user.id, near)

    const body: ContactListItem[] = rows.map((r) => ({
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
    }))

    return NextResponse.json(body)
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}

const CreateContactBody = z.object({
  firstName: z.string().trim().min(1).max(120).nullish(),
  lastName: z.string().trim().min(1).max(120).nullish(),
  company: z.string().trim().max(160).nullish(),
  notes: z.string().max(2000).nullish(),
  favorite: z.boolean().optional(),
  location: z.object({
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
    name: z.string().trim().min(1).max(160),
    address: z.string().max(400).nullish(),
  }),
  interaction: z
    .object({
      metAt: z.string().datetime().optional(),
      notes: z.string().max(2000).nullish(),
    })
    .optional(),
})

export async function POST(req: Request) {
  try {
    const user = await requireCurrentUser()

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }
    const parsed = CreateContactBody.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const input = parsed.data

    // Require at least one of firstName/lastName/company so we have
    // *something* to display in the list. Otherwise the contact is
    // anonymous and indistinguishable from another in the same place.
    if (!input.firstName && !input.lastName && !input.company) {
      return NextResponse.json(
        { error: 'one of firstName, lastName, or company is required' },
        { status: 400 },
      )
    }

    const db = getDb()
    const created = await createContactWithLocation(db, {
      ownerUserId: user.id,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      company: input.company ?? null,
      notes: input.notes ?? null,
      favorite: input.favorite,
      location: input.location,
      interaction: input.interaction
        ? {
            metAt: input.interaction.metAt ? new Date(input.interaction.metAt) : undefined,
            notes: input.interaction.notes ?? null,
          }
        : undefined,
    })

    // Pull the fresh row back through the same shape the list endpoint
    // returns so the client can stitch it into its local list without
    // a refetch.
    const rows = await getContactsNearby(db, user.id, {
      lat: input.location.lat,
      lng: input.location.lng,
    })
    const fresh = rows.find((r) => r.id === created.contactId)
    if (!fresh) {
      return NextResponse.json({ error: 'created but lookup failed' }, { status: 500 })
    }

    const body: CreateContactResult = {
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
    }
    return NextResponse.json(body, { status: 201 })
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}
