import './load-env'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  const client = postgres(url, { max: 1, prepare: false })
  const db = drizzle(client)

  // PostGIS extension must exist before our migration tries to create
  // GEOGRAPHY columns or GIST indexes on them.
  await client`CREATE EXTENSION IF NOT EXISTS postgis`

  const here = dirname(fileURLToPath(import.meta.url))
  const migrationsFolder = resolve(here, '..', 'migrations')
  console.log(`Running migrations from ${migrationsFolder}`)

  await migrate(db, { migrationsFolder })

  await client.end()
  console.log('Migrations complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
