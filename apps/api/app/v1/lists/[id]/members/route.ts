// /v1/lists/[id]/members — add a contact to a list.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { addListMember } from '@rando/db'
import { getDb } from '@/lib/db'
import { requireCurrentUser } from '@/lib/current-user'

const AddMemberBody = z
  .object({
    contactId: z.string().uuid(),
  })
  .strict()

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, ctx: RouteCtx) {
  try {
    const user = await requireCurrentUser()
    const { id } = await ctx.params

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }
    const parsed = AddMemberBody.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }

    const added = await addListMember(getDb(), user.id, id, parsed.data.contactId)
    // `added === false` covers both "already a member" and "list/contact
    // not owned by user." Idempotent: client can re-call safely. Caller
    // checks `added` to decide whether to show a "added" toast vs not.
    return NextResponse.json({ ok: true, added })
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}
