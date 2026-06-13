// Per-contact endpoints. GET returns the same ContactListItem shape the
// list endpoint emits so the client can stitch responses together; PATCH
// validates a small subset of mutable fields with Zod and refuses
// anything else.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ContactListItem } from '@rando/api-client'
import { getContactById, updateContact } from '@rando/db'
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

function mapRow(r: NonNullable<Awaited<ReturnType<typeof getContactById>>>): ContactListItem {
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

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function GET(req: Request, ctx: RouteCtx) {
  try {
    const user = await requireCurrentUser()
    const { id } = await ctx.params
    const url = new URL(req.url)
    const near = parseNear(url.searchParams.get('near'))

    const row = await getContactById(getDb(), user.id, id, near)
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(mapRow(row))
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}

const PatchBody = z
  .object({
    firstName: z.string().trim().min(1).max(120).nullable().optional(),
    lastName: z.string().trim().min(1).max(120).nullable().optional(),
    company: z.string().trim().max(160).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    favorite: z.boolean().optional(),
  })
  .strict()

export async function PATCH(req: Request, ctx: RouteCtx) {
  try {
    const user = await requireCurrentUser()
    const { id } = await ctx.params

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }
    const parsed = PatchBody.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }

    const db = getDb()
    const affected = await updateContact(db, user.id, id, parsed.data)
    if (affected === 0) {
      // Could be "not found" or "not owned" — either way, behave the same.
      // Also covers the "empty patch" case which short-circuits in the
      // query helper. We return 404 to keep the response shape uniform
      // even though an empty patch is technically a noop.
      const existing = await getContactById(db, user.id, id, null)
      if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
    }

    // Re-read with the user's last-known location if they pass `near`.
    const url = new URL(req.url)
    const near = parseNear(url.searchParams.get('near'))
    const fresh = await getContactById(db, user.id, id, near)
    if (!fresh) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(mapRow(fresh))
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}
