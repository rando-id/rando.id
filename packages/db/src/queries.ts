import { and, eq, sql } from 'drizzle-orm'
import type { Db } from './client'
import { contacts, interactions, locations } from './schema'

/** How close (meters) a new pin has to be to an existing location to reuse it. */
const LOCATION_DEDUP_RADIUS_M = 50

export type ContactNearbyRow = {
  id: string
  first_name: string | null
  last_name: string | null
  avatar_kind: 'photo' | 'gravatar' | 'monogram' | 'emoji' | 'random'
  avatar_value: string | null
  favorite: boolean
  promoted: boolean
  location_id: string | null
  location_name: string | null
  lat: number | null
  lng: number | null
  meters: number | null
}

export interface CreateContactInput {
  ownerUserId: string
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  notes?: string | null
  favorite?: boolean
  location: {
    lat: number
    lng: number
    /** Human-readable name shown in the UI (e.g. "Wilson Park"). */
    name: string
    /** Optional geocoded address. */
    address?: string | null
  }
  interaction?: {
    metAt?: Date
    notes?: string | null
  }
}

export interface CreateContactResult {
  contactId: string
  locationId: string
  /** True if we reused an existing nearby location instead of inserting a new one. */
  locationReused: boolean
}

/**
 * Insert a contact + interaction in a single transaction. Locations are
 * de-duplicated: if any location already exists within
 * LOCATION_DEDUP_RADIUS_M of the given lat/lng, we reuse it instead of
 * creating a duplicate (matches the spec's "shared canonical row" model).
 */
export async function createContactWithLocation(
  db: Db,
  input: CreateContactInput,
): Promise<CreateContactResult> {
  return await db.transaction(async (tx) => {
    const point = sql`ST_SetSRID(ST_MakePoint(${input.location.lng}, ${input.location.lat}), 4326)::geography`

    const nearby = await tx.execute<{ id: string }>(sql`
      SELECT id FROM locations
      WHERE ST_DWithin(geo, ${point}, ${LOCATION_DEDUP_RADIUS_M})
      ORDER BY ST_Distance(geo, ${point}) ASC
      LIMIT 1
    `)
    const existingRow = (nearby as unknown as Array<{ id: string }>)[0]
    let locationId: string
    let locationReused = false
    if (existingRow) {
      locationId = existingRow.id
      locationReused = true
    } else {
      const inserted = await tx
        .insert(locations)
        .values({
          // Drizzle's customType emits the WKT bytes; we go through SQL
          // directly so PostGIS does the SRID conversion server-side.
          geo: sql`ST_SetSRID(ST_MakePoint(${input.location.lng}, ${input.location.lat}), 4326)::geography` as never,
          canonicalName: input.location.name,
          geocodedAddress: input.location.address ?? null,
          source: 'user',
        })
        .returning({ id: locations.id })
      const row = inserted[0]
      if (!row) throw new Error('location insert returned no row')
      locationId = row.id
    }

    const contactInserted = await tx
      .insert(contacts)
      .values({
        ownerUserId: input.ownerUserId,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        company: input.company ?? null,
        notes: input.notes ?? null,
        favorite: input.favorite ?? false,
      })
      .returning({ id: contacts.id })
    const contactRow = contactInserted[0]
    if (!contactRow) throw new Error('contact insert returned no row')

    await tx.insert(interactions).values({
      contactId: contactRow.id,
      locationId,
      metAt: input.interaction?.metAt ?? new Date(),
      notes: input.interaction?.notes ?? null,
    })

    return { contactId: contactRow.id, locationId, locationReused }
  })
}

/**
 * Fetch a single contact by id, scoped to its owner so cross-user reads
 * fail with `not found` rather than leaking. Returns the same row shape
 * as `getContactsNearby` for API parity — `near` chooses the nearest
 * interaction, or alphabetical fallback when null.
 */
export async function getContactById(
  db: Db,
  userId: string,
  contactId: string,
  near: { lat: number; lng: number } | null,
): Promise<ContactNearbyRow | null> {
  if (!near) {
    const rows = await db.execute<ContactNearbyRow>(sql`
      SELECT
        c.id, c.first_name, c.last_name,
        c.avatar_kind, c.avatar_value, c.favorite, c.promoted,
        NULL::uuid AS location_id,
        NULL::text AS location_name,
        NULL::float8 AS lat,
        NULL::float8 AS lng,
        NULL::float8 AS meters
      FROM contacts c
      WHERE c.owner_user_id = ${userId} AND c.id = ${contactId}
    `)
    return (rows as unknown as ContactNearbyRow[])[0] ?? null
  }

  const point = sql`ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)::geography`
  const rows = await db.execute<ContactNearbyRow>(sql`
    SELECT
      c.id, c.first_name, c.last_name,
      c.avatar_kind, c.avatar_value, c.favorite, c.promoted,
      loc.id AS location_id,
      COALESCE(la.nickname, loc.canonical_name) AS location_name,
      ST_Y(loc.geo::geometry) AS lat,
      ST_X(loc.geo::geometry) AS lng,
      ST_Distance(loc.geo, ${point}) AS meters
    FROM contacts c
    LEFT JOIN LATERAL (
      SELECT l.id, l.geo, l.canonical_name
      FROM interactions i
      JOIN locations l ON l.id = i.location_id
      WHERE i.contact_id = c.id
      ORDER BY ST_Distance(l.geo, ${point}) ASC
      LIMIT 1
    ) loc ON TRUE
    LEFT JOIN location_aliases la
      ON la.location_id = loc.id AND la.user_id = c.owner_user_id
    WHERE c.owner_user_id = ${userId} AND c.id = ${contactId}
  `)
  return (rows as unknown as ContactNearbyRow[])[0] ?? null
}

export interface UpdateContactInput {
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  notes?: string | null
  favorite?: boolean
}

/**
 * Update mutable fields on a contact, scoped to the owner. Returns the
 * number of rows affected so the caller can distinguish "not found / not
 * owned" (0) from a successful update (1).
 */
export async function updateContact(
  db: Db,
  userId: string,
  contactId: string,
  patch: UpdateContactInput,
): Promise<number> {
  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.firstName !== undefined) updates.firstName = patch.firstName
  if (patch.lastName !== undefined) updates.lastName = patch.lastName
  if (patch.company !== undefined) updates.company = patch.company
  if (patch.notes !== undefined) updates.notes = patch.notes
  if (patch.favorite !== undefined) updates.favorite = patch.favorite

  // No-op when only updatedAt would change — short-circuit so we don't
  // bump the timestamp on an empty patch.
  if (Object.keys(updates).length === 1) return 0

  const result = await db
    .update(contacts)
    .set(updates)
    .where(and(eq(contacts.id, contactId), eq(contacts.ownerUserId, userId)))
    .returning({ id: contacts.id })
  return result.length
}

export async function getContactsNearby(
  db: Db,
  userId: string,
  near: { lat: number; lng: number } | null,
): Promise<ContactNearbyRow[]> {
  // Without GPS coords we still return the contact list but with null
  // distance so the caller can fall back to alphabetical sorting.
  if (!near) {
    const rows = await db.execute<ContactNearbyRow>(sql`
      SELECT
        c.id,
        c.first_name,
        c.last_name,
        c.avatar_kind,
        c.avatar_value,
        c.favorite,
        c.promoted,
        NULL::uuid AS location_id,
        NULL::text AS location_name,
        NULL::float8 AS lat,
        NULL::float8 AS lng,
        NULL::float8 AS meters
      FROM contacts c
      WHERE c.owner_user_id = ${userId}
      ORDER BY c.last_name NULLS LAST, c.first_name NULLS LAST
    `)
    return rows as unknown as ContactNearbyRow[]
  }

  const point = sql`ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)::geography`

  const rows = await db.execute<ContactNearbyRow>(sql`
    SELECT
      c.id,
      c.first_name,
      c.last_name,
      c.avatar_kind,
      c.avatar_value,
      c.favorite,
      c.promoted,
      loc.id AS location_id,
      COALESCE(la.nickname, loc.canonical_name) AS location_name,
      ST_Y(loc.geo::geometry) AS lat,
      ST_X(loc.geo::geometry) AS lng,
      ST_Distance(loc.geo, ${point}) AS meters
    FROM contacts c
    LEFT JOIN LATERAL (
      SELECT l.id, l.geo, l.canonical_name
      FROM interactions i
      JOIN locations l ON l.id = i.location_id
      WHERE i.contact_id = c.id
      ORDER BY ST_Distance(l.geo, ${point}) ASC
      LIMIT 1
    ) loc ON TRUE
    LEFT JOIN location_aliases la
      ON la.location_id = loc.id AND la.user_id = c.owner_user_id
    WHERE c.owner_user_id = ${userId}
    ORDER BY meters ASC NULLS LAST, c.last_name NULLS LAST
  `)
  return rows as unknown as ContactNearbyRow[]
}
