import { customType } from 'drizzle-orm/pg-core'

// PostGIS geography point (SRID 4326 = WGS84). Stored as a string in
// well-known-text form on read; on write we send WKT or a coordinate pair
// that the API encodes as `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography`.
export const geographyPoint = customType<{ data: string }>({
  dataType() {
    return 'geography(POINT, 4326)'
  },
})
