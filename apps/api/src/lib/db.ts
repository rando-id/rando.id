import { createDb } from '@rando/db'

let dbInstance: ReturnType<typeof createDb> | null = null

export function getDb() {
  if (!dbInstance) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    dbInstance = createDb(url)
  }
  return dbInstance
}
