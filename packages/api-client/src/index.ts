export * from './client'
export * from './contacts'
export * from './lists'
export { contract } from './contract'
export type { Contract } from './contract'

// Named zod schemas (ContactListItem, ListItem, etc.) are intentionally
// NOT re-exported here — `./contacts` and `./lists` already publish
// hand-written types with the same identifiers, and a runtime + type
// collision would result. The OpenAPI spec generator imports them via
// the `@rando/api-client/contract` subpath instead.
