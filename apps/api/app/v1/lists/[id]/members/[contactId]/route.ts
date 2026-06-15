// /v1/lists/:id/members/:contactId — remove a contact from a list.

import { createNextHandler } from '@ts-rest/serverless/next'
import { contract } from '@rando/api-client'
import { removeListMember } from '@rando/db'
import { getDb } from '@/lib/db'
import { requireCurrentUser } from '@/lib/current-user'
import { isUuid } from '@/lib/validate-uuid'

const handler = createNextHandler(
  { removeListMember: contract.removeListMember },
  {
    removeListMember: async ({ params }) => {
      try {
        if (!isUuid(params.id) || !isUuid(params.contactId)) {
          return { status: 404 as const, body: { error: 'not found' } }
        }
        const user = await requireCurrentUser()
        const removed = await removeListMember(getDb(), user.id, params.id, params.contactId)
        if (removed === 0) {
          return { status: 404 as const, body: { error: 'not found' } }
        }
        return { status: 200 as const, body: { ok: true as const } }
      } catch (e) {
        if (e instanceof Response) {
          return { status: 404 as const, body: { error: 'unauthorized' } }
        }
        throw e
      }
    },
  },
  { handlerType: 'app-router' },
)

export { handler as DELETE }
