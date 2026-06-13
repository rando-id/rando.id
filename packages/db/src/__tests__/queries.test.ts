// PostGIS-backed tests for @rando/db. Runs against a real Postgres
// (DATABASE_URL_TEST) so the geography math actually exercises. Skipped
// cleanly when the env var isn't set — local dev without docker, or
// CI without a test branch, just won't run these.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb } from '../client'
import { users } from '../schema'
import {
  addListMember,
  createContactWithLocation,
  createList,
  deleteList,
  getContactById,
  getContactsNearby,
  getListById,
  listLists,
  removeListMember,
  updateContact,
  updateListName,
} from '../queries'

const TEST_URL = process.env.DATABASE_URL_TEST

// When the env var isn't set we still need a describe block so vitest
// shows what's been skipped. `describe.skipIf` evaluates lazily; the
// suite is silent in that mode.
describe.skipIf(!TEST_URL)('queries (PostGIS)', () => {
  let db: ReturnType<typeof createDb>
  let userId: string

  beforeAll(async () => {
    if (!TEST_URL) return
    // Migrate the test DB to the current schema. Idempotent. `onnotice`
    // suppresses Postgres' "relation already exists, skipping" NOTICE
    // chatter that fires on repeated runs.
    const client = postgres(TEST_URL, {
      max: 1,
      prepare: false,
      onnotice: () => {},
    })
    const migrator = drizzle(client)
    await client`CREATE EXTENSION IF NOT EXISTS postgis`
    const here = dirname(fileURLToPath(import.meta.url))
    const migrationsFolder = resolve(here, '..', '..', 'migrations')
    await migrate(migrator, { migrationsFolder })
    await client.end()

    db = createDb(TEST_URL, { onnotice: () => {} })
  })

  beforeEach(async () => {
    if (!TEST_URL) return
    // Reset everything except locations between tests so the dedup
    // logic can be exercised cleanly. Locations are shared canonical
    // rows; truncating them isolates each test's pin from the others.
    await db.execute(sql`
      TRUNCATE TABLE
        interactions, contact_phones, contact_emails, contact_addresses,
        contact_socials, contact_pets,
        list_members, list_locations, list_children, lists,
        location_aliases, contacts, locations, users
      RESTART IDENTITY CASCADE
    `)

    // Create a fresh user for this test — every operation is owner-scoped.
    const inserted = await db
      .insert(users)
      .values({ clerkId: `test_${Date.now()}_${Math.random()}`, displayName: 'Test User' })
      .returning({ id: users.id })
    const row = inserted[0]
    if (!row) throw new Error('test user insert returned no row')
    userId = row.id
  })

  describe('createContactWithLocation', () => {
    it('creates a fresh location + contact + interaction in one tx', async () => {
      const result = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Jane',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      expect(result.contactId).toMatch(/^[0-9a-f-]{36}$/)
      expect(result.locationId).toMatch(/^[0-9a-f-]{36}$/)
      expect(result.locationReused).toBe(false)
    })

    it('reuses an existing location within 50m (PostGIS ST_DWithin)', async () => {
      const first = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Jane',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      // ~5 meters east of the first pin. Within the 50m dedup radius.
      const second = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Jeff',
        location: { lat: 33.94, lng: -118.4099, name: 'Wilson Park (typo)' },
      })
      expect(second.locationId).toBe(first.locationId)
      expect(second.locationReused).toBe(true)
    })

    it('creates a NEW location when the next pin is farther than 50m away', async () => {
      const first = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Jane',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      // ~1 km north — well outside the dedup radius.
      const second = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Different',
        location: { lat: 33.949, lng: -118.41, name: 'Another Park' },
      })
      expect(second.locationId).not.toBe(first.locationId)
      expect(second.locationReused).toBe(false)
    })

    it('persists firstName + lastName + notes + favorite on the contact', async () => {
      const { contactId } = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Jane',
        lastName: 'Smith',
        notes: 'baseball mom',
        favorite: true,
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      const row = await getContactById(db, userId, contactId, null)
      expect(row?.first_name).toBe('Jane')
      expect(row?.last_name).toBe('Smith')
      expect(row?.favorite).toBe(true)
    })
  })

  describe('getContactsNearby', () => {
    it('sorts by distance ASC when near is provided', async () => {
      // Two contacts at different distances from the query point.
      await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Near',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Far',
        // ~10 km away.
        location: { lat: 34.03, lng: -118.41, name: 'Distant Place' },
      })

      const near = { lat: 33.94, lng: -118.41 }
      const rows = await getContactsNearby(db, userId, near)
      expect(rows.map((r) => r.first_name)).toEqual(['Near', 'Far'])
      // First row is essentially zero meters away.
      expect(rows[0]?.meters).toBeLessThan(1)
      expect(rows[1]?.meters ?? 0).toBeGreaterThan(5000)
    })

    it('falls back to alphabetical when near is null', async () => {
      await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Bob',
        lastName: 'Beta',
        location: { lat: 0, lng: 0, name: 'X' },
      })
      await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Alice',
        lastName: 'Alpha',
        location: { lat: 1, lng: 1, name: 'Y' },
      })
      const rows = await getContactsNearby(db, userId, null)
      // Sorted by last_name then first_name: Alpha < Beta.
      expect(rows.map((r) => r.last_name)).toEqual(['Alpha', 'Beta'])
      expect(rows[0]?.meters).toBeNull()
    })

    it('only returns rows owned by the requesting user', async () => {
      await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Mine',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      // Another user with their own contact at the same place.
      const otherUser = (
        await db
          .insert(users)
          .values({ clerkId: `other_${Date.now()}`, displayName: 'Other' })
          .returning({ id: users.id })
      )[0]
      if (!otherUser) throw new Error('other user insert failed')
      await createContactWithLocation(db, {
        ownerUserId: otherUser.id,
        firstName: 'TheirContact',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })

      const rows = await getContactsNearby(db, userId, { lat: 33.94, lng: -118.41 })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.first_name).toBe('Mine')
    })
  })

  describe('updateContact', () => {
    it('updates only the supplied fields', async () => {
      const { contactId } = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Jane',
        lastName: 'Smith',
        notes: 'baseball mom',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      const affected = await updateContact(db, userId, contactId, { favorite: true })
      expect(affected).toBe(1)
      const row = await getContactById(db, userId, contactId, null)
      expect(row?.favorite).toBe(true)
      // Untouched fields remain.
      expect(row?.first_name).toBe('Jane')
      expect(row?.last_name).toBe('Smith')
    })

    it('returns 0 when the contact is owned by a different user (cross-user write fails silently)', async () => {
      const { contactId } = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Jane',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      const otherUser = (
        await db
          .insert(users)
          .values({ clerkId: `other_${Date.now()}_${Math.random()}`, displayName: 'Other' })
          .returning({ id: users.id })
      )[0]
      if (!otherUser) throw new Error('other user insert failed')
      const affected = await updateContact(db, otherUser.id, contactId, { favorite: true })
      expect(affected).toBe(0)
      const row = await getContactById(db, userId, contactId, null)
      expect(row?.favorite).toBe(false)
    })

    it('short-circuits on an empty patch (returns 0, no UPDATE issued)', async () => {
      const { contactId } = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Jane',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      const affected = await updateContact(db, userId, contactId, {})
      expect(affected).toBe(0)
    })
  })

  describe('getContactById', () => {
    it('returns null when the id does not exist for this user', async () => {
      const row = await getContactById(db, userId, '00000000-0000-0000-0000-000000000000', null)
      expect(row).toBeNull()
    })

    it('returns distance when near is provided', async () => {
      const { contactId } = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Jane',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      const row = await getContactById(db, userId, contactId, { lat: 33.94, lng: -118.41 })
      expect(row?.meters).toBeLessThan(1)
    })
  })

  describe('lists', () => {
    it('createList + listLists round-trip', async () => {
      const created = await createList(db, userId, 'School pickup')
      expect(created.name).toBe('School pickup')
      expect(created.kind).toBe('custom')
      const all = await listLists(db, userId)
      expect(all).toHaveLength(1)
      expect(all[0]?.id).toBe(created.id)
      expect(all[0]?.memberCount).toBe(0)
    })

    it('lists are owner-scoped — other users do not see them', async () => {
      await createList(db, userId, 'Mine')
      const other = (
        await db
          .insert(users)
          .values({ clerkId: `o_${Date.now()}_${Math.random()}`, displayName: 'X' })
          .returning({ id: users.id })
      )[0]
      if (!other) throw new Error('other user insert failed')
      const otherLists = await listLists(db, other.id)
      expect(otherLists).toHaveLength(0)
    })

    it('updateListName + deleteList both return affected counts', async () => {
      const { id } = await createList(db, userId, 'Old name')
      expect(await updateListName(db, userId, id, 'New name')).toBe(1)
      const fresh = await getListById(db, userId, id)
      expect(fresh?.name).toBe('New name')

      expect(await deleteList(db, userId, id)).toBe(1)
      expect(await getListById(db, userId, id)).toBeNull()
    })

    it('cross-user updates / deletes return 0', async () => {
      const { id } = await createList(db, userId, 'Mine')
      const other = (
        await db
          .insert(users)
          .values({ clerkId: `o_${Date.now()}_${Math.random()}`, displayName: 'X' })
          .returning({ id: users.id })
      )[0]
      if (!other) throw new Error('other user insert failed')
      expect(await updateListName(db, other.id, id, 'Stolen')).toBe(0)
      expect(await deleteList(db, other.id, id)).toBe(0)
    })

    it('addListMember + removeListMember + memberCount roll up', async () => {
      const { id: listId } = await createList(db, userId, 'Squad')
      const { contactId } = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Jane',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })

      expect(await addListMember(db, userId, listId, contactId)).toBe(true)
      // Idempotent — re-add returns false.
      expect(await addListMember(db, userId, listId, contactId)).toBe(false)

      const all = await listLists(db, userId)
      expect(all[0]?.memberCount).toBe(1)

      expect(await removeListMember(db, userId, listId, contactId)).toBe(1)
      const afterRemove = await listLists(db, userId)
      expect(afterRemove[0]?.memberCount).toBe(0)
    })

    it('addListMember refuses to graft cross-user lists or contacts', async () => {
      const other = (
        await db
          .insert(users)
          .values({ clerkId: `o_${Date.now()}_${Math.random()}`, displayName: 'X' })
          .returning({ id: users.id })
      )[0]
      if (!other) throw new Error('other user insert failed')
      const { id: theirList } = await createList(db, other.id, 'Theirs')
      const { contactId: mine } = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Mine',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      // I cannot add my contact to their list.
      expect(await addListMember(db, userId, theirList, mine)).toBe(false)
    })
  })

  describe('getContactsNearby filters', () => {
    it('favorites=true returns only favorited contacts', async () => {
      await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Yes',
        favorite: true,
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'No',
        favorite: false,
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      const favorites = await getContactsNearby(db, userId, null, { favorites: true })
      expect(favorites.map((r) => r.first_name)).toEqual(['Yes'])
    })

    it('q filter is case-insensitive across first/last/company', async () => {
      await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Jane',
        lastName: 'Smith',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Bob',
        lastName: 'Jones',
        company: 'Acme Corp',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Other',
        lastName: 'Person',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })

      // Matches 'Jane' (first name) and 'Jones' (last name).
      const byJ = await getContactsNearby(db, userId, null, { q: 'j' })
      expect(byJ.map((r) => r.first_name).sort()).toEqual(['Bob', 'Jane'])

      // Matches via company substring, case-insensitive.
      const byCompany = await getContactsNearby(db, userId, null, { q: 'acme' })
      expect(byCompany.map((r) => r.first_name)).toEqual(['Bob'])

      // Trims so '   ' alone doesn't ILIKE-match everything.
      const byWhitespace = await getContactsNearby(db, userId, null, { q: '   ' })
      expect(byWhitespace).toHaveLength(3)
    })

    it('sort=last_name orders alphabetically even when near is set', async () => {
      await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Zoe',
        lastName: 'Zhang',
        // Very close to the query point.
        location: { lat: 33.94, lng: -118.41, name: 'A' },
      })
      await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Alice',
        lastName: 'Alpha',
        // Farther — would come second by distance.
        location: { lat: 34.03, lng: -118.41, name: 'B' },
      })

      const byLast = await getContactsNearby(
        db,
        userId,
        { lat: 33.94, lng: -118.41 },
        { sort: 'last_name' },
      )
      expect(byLast.map((r) => r.last_name)).toEqual(['Alpha', 'Zhang'])
    })

    it('sort=date_added orders newest first', async () => {
      const first = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'First',
        location: { lat: 33.94, lng: -118.41, name: 'X' },
      })
      // Force a 1ms gap to make created_at strictly increasing.
      await new Promise((r) => setTimeout(r, 10))
      const second = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Second',
        location: { lat: 33.94, lng: -118.41, name: 'X' },
      })
      const rows = await getContactsNearby(db, userId, null, { sort: 'date_added' })
      expect(rows.map((r) => r.id)).toEqual([second.contactId, first.contactId])
    })

    it('listId filter scopes to members of that list', async () => {
      const { id: listId } = await createList(db, userId, 'Squad')
      const { contactId: included } = await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'In',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      await createContactWithLocation(db, {
        ownerUserId: userId,
        firstName: 'Out',
        location: { lat: 33.94, lng: -118.41, name: 'Wilson Park' },
      })
      await addListMember(db, userId, listId, included)
      const onList = await getContactsNearby(db, userId, null, { listId })
      expect(onList.map((r) => r.first_name)).toEqual(['In'])
    })
  })
})

if (!TEST_URL) {
  console.warn(
    '[skipped] @rando/db query tests need DATABASE_URL_TEST pointing at a Postgres+PostGIS instance ' +
      '(e.g. postgres://rando:rando@localhost:5432/rando_test). See docker-compose for a local one.',
  )
}
