// /v1/lists/[id]/members/[contactId] — remove a contact from a list.

import { NextResponse } from 'next/server'
import { removeListMember } from '@rando/db'
import { getDb } from '@/lib/db'
import { requireCurrentUser } from '@/lib/current-user'

interface RouteCtx {
  params: Promise<{ id: string; contactId: string }>
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  try {
    const user = await requireCurrentUser()
    const { id, contactId } = await ctx.params

    const removed = await removeListMember(getDb(), user.id, id, contactId)
    if (removed === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}
