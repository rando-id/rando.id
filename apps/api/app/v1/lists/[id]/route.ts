// /v1/lists/[id] — GET (with members embedded), PATCH (rename), DELETE.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ContactListItem, ListWithMembers } from '@rando/api-client'
import { deleteList, getContactsNearby, getListById, updateListName } from '@rando/db'
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

function mapRow(
  r: NonNullable<Awaited<ReturnType<typeof getContactsNearby>>[number]>,
): ContactListItem {
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

    const db = getDb()
    const list = await getListById(db, user.id, id)
    if (!list) return NextResponse.json({ error: 'not found' }, { status: 404 })

    const memberRows = await getContactsNearby(db, user.id, near, { listId: id })

    const body: ListWithMembers = {
      id: list.id,
      name: list.name,
      kind: list.kind,
      coverImage: list.coverImage,
      createdAt: list.createdAt.toISOString(),
      updatedAt: list.updatedAt.toISOString(),
      memberCount: memberRows.length,
      members: memberRows.map(mapRow),
    }
    return NextResponse.json(body)
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}

const PatchBody = z
  .object({
    name: z.string().trim().min(1).max(120),
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
    const affected = await updateListName(db, user.id, id, parsed.data.name)
    if (affected === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    const fresh = await getListById(db, user.id, id)
    if (!fresh) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({
      id: fresh.id,
      name: fresh.name,
      kind: fresh.kind,
      coverImage: fresh.coverImage,
      createdAt: fresh.createdAt.toISOString(),
      updatedAt: fresh.updatedAt.toISOString(),
      memberCount: fresh.memberCount ?? 0,
    })
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  try {
    const user = await requireCurrentUser()
    const { id } = await ctx.params

    const affected = await deleteList(getDb(), user.id, id)
    if (affected === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}
