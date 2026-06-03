import { auth } from '@clerk/nextjs/server'
import { eq, users } from '@rando/db'
import { getDb } from './db'

export async function getCurrentUser() {
  const { userId: clerkId } = await auth()
  if (!clerkId) return null
  const db = getDb()
  const rows = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1)
  return rows[0] ?? null
}

export async function requireCurrentUser() {
  const user = await getCurrentUser()
  if (!user) {
    throw new Response('Unauthorized', { status: 401 })
  }
  return user
}
