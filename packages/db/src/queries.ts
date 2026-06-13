import { and, eq, sql } from 'drizzle-orm'
import type { Db } from './client'
import { contacts, interactions, lists, locations } from './schema'

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

export type ContactSort = 'distance' | 'last_name' | 'date_added' | 'date_updated'

export interface ListContactsFilter {
  /** Only return contacts where `favorite = true`. */
  favorites?: boolean
  /** Only return contacts that are members of the given list. */
  listId?: string
  /** Free-text search — case-insensitive substring on first/last/company. */
  q?: string
  /** Sort mode. Defaults to 'distance' when near is provided, else 'last_name'. */
  sort?: ContactSort
}

const SORT_CLAUSES: Record<ContactSort, ReturnType<typeof sql>> = {
  distance: sql`ORDER BY meters ASC NULLS LAST, c.last_name NULLS LAST`,
  last_name: sql`ORDER BY c.last_name NULLS LAST, c.first_name NULLS LAST`,
  date_added: sql`ORDER BY c.created_at DESC`,
  date_updated: sql`ORDER BY c.updated_at DESC`,
}

export async function getContactsNearby(
  db: Db,
  userId: string,
  near: { lat: number; lng: number } | null,
  filter: ListContactsFilter = {},
): Promise<ContactNearbyRow[]> {
  const favoritesClause = filter.favorites ? sql`AND c.favorite = TRUE` : sql``
  const listClause = filter.listId
    ? sql`AND EXISTS (
        SELECT 1 FROM list_members lm
        JOIN lists l ON l.id = lm.list_id
        WHERE lm.contact_id = c.id
          AND lm.list_id = ${filter.listId}
          AND l.owner_user_id = ${userId}
      )`
    : sql``
  // ILIKE substring against name/company. Trimmed to avoid leading/
  // trailing whitespace from the URL ever matching everything via `%`.
  const trimmedQ = filter.q?.trim()
  const qClause = trimmedQ
    ? sql`AND (
        c.first_name ILIKE ${'%' + trimmedQ + '%'}
        OR c.last_name ILIKE ${'%' + trimmedQ + '%'}
        OR c.company ILIKE ${'%' + trimmedQ + '%'}
      )`
    : sql``

  // Effective sort: if caller asked for 'distance' but didn't provide
  // coords, fall back to last_name — sorting by NULL distance is a no-op
  // and `last_name` is the alphabetical default everywhere else.
  const effectiveSort: ContactSort = filter.sort ?? (near ? 'distance' : 'last_name')
  const orderClause =
    SORT_CLAUSES[effectiveSort === 'distance' && !near ? 'last_name' : effectiveSort]

  // Without GPS coords we still return the contact list but with null
  // distance.
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
        ${favoritesClause}
        ${listClause}
        ${qClause}
      ${orderClause}
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
      ${favoritesClause}
      ${listClause}
      ${qClause}
    ${orderClause}
  `)
  return rows as unknown as ContactNearbyRow[]
}

// ── Lists ───────────────────────────────────────────────────────────────

export type ListKind = 'custom' | 'location' | 'group' | 'favorites' | 'promoted'

export interface ListRow {
  id: string
  ownerUserId: string
  name: string
  kind: ListKind
  coverImage: string | null
  createdAt: Date
  updatedAt: Date
  /** Cached member count — only populated by `listLists`. */
  memberCount?: number
}

/** All lists for a user, with their current member count. */
export async function listLists(db: Db, userId: string): Promise<ListRow[]> {
  const rows = await db.execute<{
    id: string
    owner_user_id: string
    name: string
    kind: ListKind
    cover_image: string | null
    created_at: string
    updated_at: string
    member_count: number
  }>(sql`
    SELECT
      l.id, l.owner_user_id, l.name, l.kind, l.cover_image, l.created_at, l.updated_at,
      COALESCE(lm_count.c, 0)::int AS member_count
    FROM lists l
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS c FROM list_members WHERE list_id = l.id
    ) lm_count ON TRUE
    WHERE l.owner_user_id = ${userId}
    ORDER BY l.created_at ASC
  `)
  return (
    rows as unknown as Array<{
      id: string
      owner_user_id: string
      name: string
      kind: ListKind
      cover_image: string | null
      created_at: string
      updated_at: string
      member_count: number
    }>
  ).map((r) => ({
    id: r.id,
    ownerUserId: r.owner_user_id,
    name: r.name,
    kind: r.kind,
    coverImage: r.cover_image,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    memberCount: r.member_count,
  }))
}

export async function createList(
  db: Db,
  userId: string,
  name: string,
  kind: ListKind = 'custom',
): Promise<ListRow> {
  const inserted = await db.insert(lists).values({ ownerUserId: userId, name, kind }).returning()
  const row = inserted[0]
  if (!row) throw new Error('list insert returned no row')
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    kind: row.kind,
    coverImage: row.coverImage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    memberCount: 0,
  }
}

export async function getListById(db: Db, userId: string, listId: string): Promise<ListRow | null> {
  const rows = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.ownerUserId, userId)))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    kind: row.kind,
    coverImage: row.coverImage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function updateListName(
  db: Db,
  userId: string,
  listId: string,
  name: string,
): Promise<number> {
  const result = await db
    .update(lists)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(lists.id, listId), eq(lists.ownerUserId, userId)))
    .returning({ id: lists.id })
  return result.length
}

export async function deleteList(db: Db, userId: string, listId: string): Promise<number> {
  const result = await db
    .delete(lists)
    .where(and(eq(lists.id, listId), eq(lists.ownerUserId, userId)))
    .returning({ id: lists.id })
  return result.length
}

/**
 * Add a contact to a list. Verifies the user owns BOTH the list and the
 * contact in a single SQL statement so cross-user grafting is impossible.
 * Returns true if a new membership was created, false if the row already
 * existed or ownership failed.
 */
export async function addListMember(
  db: Db,
  userId: string,
  listId: string,
  contactId: string,
): Promise<boolean> {
  // Use INSERT … SELECT so the existence checks happen in the same
  // statement, avoiding TOCTOU between two separate verifications.
  const result = await db.execute<{ list_id: string }>(sql`
    INSERT INTO list_members (list_id, contact_id)
    SELECT ${listId}::uuid, ${contactId}::uuid
    WHERE EXISTS (
      SELECT 1 FROM lists WHERE id = ${listId}::uuid AND owner_user_id = ${userId}::uuid
    )
      AND EXISTS (
        SELECT 1 FROM contacts WHERE id = ${contactId}::uuid AND owner_user_id = ${userId}::uuid
      )
    ON CONFLICT DO NOTHING
    RETURNING list_id
  `)
  return (result as unknown as Array<{ list_id: string }>).length > 0
}

export async function removeListMember(
  db: Db,
  userId: string,
  listId: string,
  contactId: string,
): Promise<number> {
  // Delete only if the user owns the list. Contact ownership doesn't
  // matter for removal — if it's on the user's list, removing it is
  // their right.
  const result = await db.execute<{ list_id: string }>(sql`
    DELETE FROM list_members
    WHERE list_id = ${listId}::uuid
      AND contact_id = ${contactId}::uuid
      AND EXISTS (
        SELECT 1 FROM lists WHERE id = ${listId}::uuid AND owner_user_id = ${userId}::uuid
      )
    RETURNING list_id
  `)
  return (result as unknown as Array<{ list_id: string }>).length
}
