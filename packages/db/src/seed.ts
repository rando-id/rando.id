import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from './schema'
import { contacts, interactions, lists, listMembers, locations, users } from './schema'

type Coord = { lat: number; lng: number; name: string }

// Real-world locations around Placentia/Orange County, CA — close enough that
// the "sort by distance" demo shows realistic differences.
const LOCATIONS: Coord[] = [
  { name: 'Tuffree Park', lat: 33.8973, lng: -117.8632 },
  { name: 'Koch Park', lat: 33.8826, lng: -117.8551 },
  { name: 'Clark Elementary', lat: 33.8784, lng: -117.8645 },
  { name: 'Yorba Linda Library', lat: 33.8856, lng: -117.8131 },
  { name: 'Placentia Sports Complex', lat: 33.8918, lng: -117.8447 },
]

const CONTACT_NAMES: { firstName: string; lastName: string; locationIndex: number }[] = [
  { firstName: 'Maya', lastName: 'Rivera', locationIndex: 0 },
  { firstName: 'Daniel', lastName: 'Chen', locationIndex: 0 },
  { firstName: 'Priya', lastName: 'Shah', locationIndex: 1 },
  { firstName: 'Tom', lastName: 'Brennan', locationIndex: 1 },
  { firstName: 'Sara', lastName: 'Liu', locationIndex: 2 },
  { firstName: 'Marcus', lastName: 'Okafor', locationIndex: 2 },
  { firstName: 'Eleanor', lastName: 'Garcia', locationIndex: 3 },
  { firstName: 'Jake', lastName: 'Nguyen', locationIndex: 4 },
  { firstName: 'Lena', lastName: 'Park', locationIndex: 4 },
  { firstName: 'Alex', lastName: 'Morales', locationIndex: 4 },
]

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }
  const clerkId = process.env.SEED_CLERK_ID ?? 'user_seed_local_dev'
  const displayName = process.env.SEED_USER_NAME ?? 'Local Dev User'

  const client = postgres(url, { max: 1, prepare: false })
  const db = drizzle(client, { schema })

  console.log(`Seeding for clerkId=${clerkId}`)

  // 1) user
  const [user] = await db
    .insert(users)
    .values({ clerkId, displayName })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: { displayName },
    })
    .returning()
  if (!user) throw new Error('failed to create seed user')

  // 2) locations — insert via raw SQL because the geography column needs
  // ST_SetSRID(ST_MakePoint(...))::geography expressions.
  const locationIds: string[] = []
  for (const loc of LOCATIONS) {
    const [row] = await client<{ id: string }[]>`
      INSERT INTO locations (geo, canonical_name, source)
      VALUES (
        ST_SetSRID(ST_MakePoint(${loc.lng}, ${loc.lat}), 4326)::geography,
        ${loc.name},
        'osm'
      )
      RETURNING id
    `
    if (!row) throw new Error(`failed to create location ${loc.name}`)
    locationIds.push(row.id)
  }
  console.log(`Inserted ${locationIds.length} locations`)

  // 3) contacts + interactions
  const contactRows = await db
    .insert(contacts)
    .values(
      CONTACT_NAMES.map((c) => ({
        ownerUserId: user.id,
        firstName: c.firstName,
        lastName: c.lastName,
      })),
    )
    .returning()
  console.log(`Inserted ${contactRows.length} contacts`)

  await db.insert(interactions).values(
    contactRows.map((contact, i) => ({
      contactId: contact.id,
      locationId: locationIds[CONTACT_NAMES[i]!.locationIndex]!,
    })),
  )
  console.log(`Inserted ${contactRows.length} interactions`)

  // 4) a couple of lists so the list infrastructure has data
  const [favoritesList] = await db
    .insert(lists)
    .values({
      ownerUserId: user.id,
      name: 'Favorites',
      kind: 'favorites',
    })
    .returning()

  const [tuffreeList] = await db
    .insert(lists)
    .values({
      ownerUserId: user.id,
      name: 'Tuffree pickleball',
      kind: 'location',
    })
    .returning()

  if (favoritesList && contactRows[0]) {
    await db.insert(listMembers).values({
      listId: favoritesList.id,
      contactId: contactRows[0].id,
    })
    await db.update(contacts).set({ favorite: true }).where(sql`id = ${contactRows[0].id}`)
  }

  if (tuffreeList) {
    const tuffreeContacts = contactRows
      .filter((_, i) => CONTACT_NAMES[i]?.locationIndex === 0)
      .map((c) => ({ listId: tuffreeList.id, contactId: c.id }))
    if (tuffreeContacts.length > 0) {
      await db.insert(listMembers).values(tuffreeContacts)
    }
  }

  await client.end()
  console.log('Seed complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
