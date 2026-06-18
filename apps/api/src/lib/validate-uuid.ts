const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Match a canonical UUID string (8-4-4-4-12 hex). Used by `[id]`
 * route handlers to 404 immediately on non-UUID path params, rather
 * than letting Postgres cast errors leak the column type via a 500.
 */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}
