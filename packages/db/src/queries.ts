import { sql } from 'drizzle-orm'
import type { Db } from './client'

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
