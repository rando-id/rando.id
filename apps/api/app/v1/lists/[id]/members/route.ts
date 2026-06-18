// /v1/lists/:id/members — add a contact to a list. Idempotent.

import { createNextHandler } from '@ts-rest/serverless/next'
import { contract } from '@rando/api-client'
import { addListMember } from '@rando/db'
import { getDb } from '@/lib/db'
import { requireCurrentUser } from '@/lib/current-user'
import { isUuid } from '@/lib/validate-uuid'

const handler = createNextHandler(
  { addListMember: contract.addListMember },
  {
    addListMember: async ({ params, body }) => {
      try {
        if (!isUuid(params.id)) return { status: 400 as const, body: { error: 'not found' } }
        const user = await requireCurrentUser()
        // `added === false` covers both "already a member" and
        // "list/contact not owned" — idempotent on both axes. The
        // client uses `added` to decide whether to show a toast.
        const added = await addListMember(getDb(), user.id, params.id, body.contactId)
        return { status: 200 as const, body: { ok: true as const, added } }
      } catch (e) {
        if (e instanceof Response) {
          return { status: 400 as const, body: { error: 'unauthorized' } }
        }
        throw e
      }
    },
  },
  { handlerType: 'app-router' },
)

export { handler as POST }
