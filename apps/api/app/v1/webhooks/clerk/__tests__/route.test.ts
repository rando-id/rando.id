// Clerk webhook handler tests. svix's signature verifier is mocked
// directly; @rando/db's `users` + `insert`/`delete` chain is mocked to
// capture what the handler tries to write.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const verify = vi.fn()
vi.mock('svix', () => ({
  Webhook: vi.fn(() => ({ verify })),
}))

const onConflictDoUpdate = vi.fn(async () => {})
const insertValues = vi.fn(() => ({ onConflictDoUpdate }))
const deleteWhere = vi.fn(async () => {})

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    insert: () => ({ values: insertValues }),
    delete: () => ({ where: deleteWhere }),
  }),
}))

vi.mock('@rando/db', () => ({
  users: { clerkId: 'users.clerkId' },
  eq: (col: unknown, val: unknown) => ({ col, val }),
}))

import { POST } from '../route'

const HEADERS = {
  'svix-id': 'msg_1',
  'svix-timestamp': '1700000000',
  'svix-signature': 'v1,sig',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CLERK_WEBHOOK_SECRET = 'whsec_test'
})

afterEach(() => {
  delete process.env.CLERK_WEBHOOK_SECRET
})

function req(body: unknown, headers: Record<string, string> = HEADERS): Request {
  return new Request('http://localhost/v1/webhooks/clerk', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers,
  })
}

describe('POST /v1/webhooks/clerk', () => {
  it('500s when the webhook secret is not configured', async () => {
    delete process.env.CLERK_WEBHOOK_SECRET
    const res = await POST(req({ type: 'user.created' }))
    expect(res.status).toBe(500)
  })

  it('400s when svix headers are missing', async () => {
    const res = await POST(req({ type: 'user.created' }, {}))
    expect(res.status).toBe(400)
  })

  it('401s when svix.verify throws', async () => {
    verify.mockImplementation(() => {
      throw new Error('bad signature')
    })
    const res = await POST(req({ type: 'user.created', data: { id: 'u_1' } }))
    expect(res.status).toBe(401)
  })

  it('400s when the payload does not match clerkWebhookSchema', async () => {
    verify.mockReturnValue({ type: 'something.unknown', data: {} })
    const res = await POST(req({ type: 'something.unknown', data: {} }))
    expect(res.status).toBe(400)
  })

  it('upserts on user.created with values + onConflictDoUpdate', async () => {
    verify.mockReturnValue({
      type: 'user.created',
      data: { id: 'u_clerk_1', first_name: 'Jane', last_name: 'Smith' },
    })
    const res = await POST(req({ type: 'user.created' }))
    expect(res.status).toBe(200)
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ clerkId: 'u_clerk_1' }))
    expect(onConflictDoUpdate).toHaveBeenCalled()
  })

  it('deletes on user.deleted', async () => {
    verify.mockReturnValue({ type: 'user.deleted', data: { id: 'u_clerk_2' } })
    const res = await POST(req({ type: 'user.deleted' }))
    expect(res.status).toBe(200)
    expect(deleteWhere).toHaveBeenCalled()
  })
})
