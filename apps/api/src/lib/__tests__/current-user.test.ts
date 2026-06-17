// Tests for current-user.ts. Mocks Clerk's `auth()` + the Drizzle query
// chain so we can exercise both the null-clerkId and the user-not-found
// branches without a real DB.
//
// vi.mock is hoisted above imports, so the mock factories use vi.hoisted
// to create shared spies that the test bodies below can still configure.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limit: vi.fn(),
  getDb: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: mocks.auth,
}))

vi.mock('../db', () => ({
  getDb: mocks.getDb,
}))

vi.mock('@rando/db', () => ({
  users: { clerkId: 'users.clerkId' },
  eq: (col: unknown, val: unknown) => ({ col, val }),
}))

import { getCurrentUser, requireCurrentUser } from '../current-user'

beforeEach(() => {
  vi.clearAllMocks()
  // Rebuild the Drizzle method chain on each test so the `limit` spy
  // attached at the leaf reflects the per-test mockResolvedValue.
  mocks.getDb.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({ limit: mocks.limit }),
      }),
    }),
  })
})

describe('getCurrentUser', () => {
  it('returns null when Clerk has no user', async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    expect(await getCurrentUser()).toBeNull()
    expect(mocks.getDb).not.toHaveBeenCalled()
  })

  it('returns null when no row matches the clerk id', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_clerk_123' })
    mocks.limit.mockResolvedValue([])
    expect(await getCurrentUser()).toBeNull()
  })

  it('returns the row when one exists', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_clerk_123' })
    const row = { id: 'u_1', clerkId: 'user_clerk_123' }
    mocks.limit.mockResolvedValue([row])
    expect(await getCurrentUser()).toEqual(row)
  })
})

describe('requireCurrentUser', () => {
  it('throws a 401 Response when no user is signed in', async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    try {
      await requireCurrentUser()
      expect.fail('expected requireCurrentUser to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(Response)
      expect((e as Response).status).toBe(401)
    }
  })

  it('returns the user row when one exists', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_clerk_123' })
    const row = { id: 'u_1', clerkId: 'user_clerk_123' }
    mocks.limit.mockResolvedValue([row])
    expect(await requireCurrentUser()).toEqual(row)
  })
})
