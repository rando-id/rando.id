import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export interface CreateDbOptions {
  /** Pass a no-op to silence Postgres NOTICE output (useful in tests). */
  onnotice?: (notice: postgres.Notice) => void
}

export function createDb(databaseUrl: string, options: CreateDbOptions = {}) {
  const client = postgres(databaseUrl, { prepare: false, onnotice: options.onnotice })
  return drizzle(client, { schema })
}

export type Db = ReturnType<typeof createDb>

export function createPostgresClient(databaseUrl: string, options: CreateDbOptions = {}) {
  return postgres(databaseUrl, { prepare: false, onnotice: options.onnotice })
}
