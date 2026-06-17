// /v1/lists — list + create, served from one ts-rest handler.

import { createNextHandler } from '@ts-rest/serverless/next'
import { contract } from '@rando/api-client'
import { createList, listLists, type ListRow } from '@rando/db'
import { getDb } from '@/lib/db'
import { requireCurrentUser } from '@/lib/current-user'

function mapList(r: ListRow) {
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

const handler = createNextHandler(
  { listLists: contract.listLists, createList: contract.createList },
  {
    listLists: async () => {
      try {
        const user = await requireCurrentUser()
        const rows = await listLists(getDb(), user.id)
        return { status: 200 as const, body: rows.map(mapList) }
      } catch (e) {
        if (e instanceof Response) {
          return { status: 200 as const, body: [] }
        }
        throw e
      }
    },

    createList: async ({ body }) => {
      try {
        const user = await requireCurrentUser()
        const list = await createList(getDb(), user.id, body.name)
        return { status: 201 as const, body: mapList(list) }
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

export { handler as GET, handler as POST }
