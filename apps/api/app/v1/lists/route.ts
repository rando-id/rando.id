// /v1/lists — list of lists (GET) + create a custom list (POST).

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ListItem } from '@rando/api-client'
import { createList, listLists, type ListRow } from '@rando/db'
import { getDb } from '@/lib/db'
import { requireCurrentUser } from '@/lib/current-user'

function mapList(r: ListRow): ListItem {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    coverImage: r.coverImage,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    memberCount: r.memberCount ?? 0,
  }
}

export async function GET() {
  try {
    const user = await requireCurrentUser()
    const rows = await listLists(getDb(), user.id)
    return NextResponse.json(rows.map(mapList))
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}

const CreateListBody = z
  .object({
    name: z.string().trim().min(1).max(120),
  })
  .strict()

export async function POST(req: Request) {
  try {
    const user = await requireCurrentUser()

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }
    const parsed = CreateListBody.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }

    const list = await createList(getDb(), user.id, parsed.data.name)
    return NextResponse.json(mapList(list), { status: 201 })
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}
