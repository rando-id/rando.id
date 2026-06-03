import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  const client = postgres(url, { max: 1, prepare: false })
  console.log('Dropping public schema…')
  await client`DROP SCHEMA IF EXISTS public CASCADE`
  await client`CREATE SCHEMA public`
  await client.end()
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
