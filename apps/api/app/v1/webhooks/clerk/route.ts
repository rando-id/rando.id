import { Webhook } from 'svix'
import { NextResponse } from 'next/server'
import {
  clerkWebhookSchema,
  displayNameFromClerk,
} from '@rando/auth/webhooks'
import { eq, users } from '@rando/db'
import { getDb } from '@/lib/db'

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET
  if (!secret) return new Response('webhook secret not configured', { status: 500 })

  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('missing svix headers', { status: 400 })
  }

  const body = await req.text()
  let verified: unknown
  try {
    verified = new Webhook(secret).verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    })
  } catch {
    return new Response('invalid signature', { status: 401 })
  }

  const parsed = clerkWebhookSchema.safeParse(verified)
  if (!parsed.success) {
    return new Response(`invalid payload: ${parsed.error.message}`, { status: 400 })
  }

  const db = getDb()
  const event = parsed.data

  if (event.type === 'user.created' || event.type === 'user.updated') {
    const displayName = displayNameFromClerk(event.data)
    await db
      .insert(users)
      .values({
        clerkId: event.data.id,
        displayName,
      })
      .onConflictDoUpdate({
        target: users.clerkId,
        set: { displayName, updatedAt: new Date() },
      })
  } else if (event.type === 'user.deleted') {
    await db.delete(users).where(eq(users.clerkId, event.data.id))
  }

  return NextResponse.json({ ok: true })
}
