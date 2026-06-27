---
status: proposed
issue: 240
---

# Shared types derived from db schema

## Why

Today, the same domain concept (e.g. `Contact`, `List`) is typed in
multiple places:

- `packages/db/src/schema/` — drizzle schema (canonical SQL truth)
- `packages/api-client/src/contract.ts` — API request / response
  shapes (used by client + server)
- `apps/web/src/features/contacts/` — UI-level prop types
- `packages/auth/` — user shape (overlaps with Clerk's)

Drift happens. Today's contacts UI already has subtle mismatches
between what `@rando/api-client` returns and what
`features/contacts/helpers.ts` expects. The right fix: **drizzle
schema is the root**, everything else extends.

## Decision

Single source of truth: `packages/db/src/schema/<table>.ts` defines
table + types via drizzle's `$inferInsert` / `$inferSelect`. All
other type definitions extend from there.

```ts
// packages/db/src/schema/contacts.ts
export const contactsTable = pgTable('contacts', { ... })
export type ContactRow = typeof contactsTable.$inferSelect
export type NewContact = typeof contactsTable.$inferInsert
```

Downstream consumers narrow / widen:

```ts
// packages/api-client/src/contract.ts
import type { ContactRow } from '@rando/db/schema'
export type ContactResponse = Omit<ContactRow, 'userId' | 'deletedAt'>
export type CreateContactRequest = Pick<NewContact, 'name' | 'lat' | 'lng'>

// apps/web/src/features/contacts/types.ts
import type { ContactResponse } from '@rando/api-client'
export interface ContactCardProps {
  contact: ContactResponse
  onEdit: () => void
}
```

## Why drizzle's inference (not zod-as-source)

| Source                         | Pros                                                                                                           | Cons                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Drizzle schema** (chosen)    | One source already drives the DB. SQL is the boundary of truth — runtime data conforms to it or doesn't exist. | Drizzle-specific; coupling DB tool change to schema-elsewhere                               |
| zod schemas                    | Runtime validation + type inference in one. Already in the dep tree.                                           | Two sources of truth (zod for shape, drizzle for SQL) unless we generate one from the other |
| Hand-authored TypeScript types | Most control                                                                                                   | Worst drift; what we have today                                                             |

Drizzle's `$inferSelect` is the right anchor because:

- The DB is the only thing that has to exist for the app to work
- Drizzle types are stable across drizzle minor version bumps (we just did
  0.38 → 0.45 in #159 with zero type-surface change)
- Zod validation can still happen at the API boundary using
  `drizzle-zod` to derive zod schemas FROM drizzle — single source

## Touch points

1. `packages/db/src/schema/<table>.ts` — already exists; expose
   `$inferSelect` / `$inferInsert` as named exports per table.
2. `packages/db/src/index.ts` — re-export all schema types under
   a `schema` namespace.
3. `packages/api-client/src/contract.ts` — replace hand-authored
   types with extends from `@rando/db/schema`.
4. `apps/api/src/routes/**.ts` — typecheck against `@rando/db/schema`
   for request validation (use `drizzle-zod` for zod schemas).
5. `apps/web/src/features/**/*.ts` — import from
   `@rando/api-client` (which now derives from db).
6. `packages/auth/src/types.ts` — define `User` extending from
   `users` table, augmenting with Clerk-side fields.
7. `pnpm-workspace.yaml` — no change (workspace deps already wired).
8. `.notes/tech-drizzle.spec.md` — link this spec.

## Naming convention

Three type variants per table, all derived from drizzle:

- **`<X>Row`**: full DB row (e.g. `ContactRow`)
- **`New<X>`**: insertable (omits server-generated cols like `id`, `createdAt`)
- **`<X>Update`**: partial of inferSelect minus immutable cols

Then API-client redefines:

- **`<X>Response`**: what the API returns to clients (omits sensitive cols)
- **`Create<X>Request`** / **`Update<X>Request`**: input shapes

Web-side prop types extend from `<X>Response`, not `<X>Row` — the
boundary that matters at the UI is "what came from the API."

## What we accept

- **Drizzle as foundational dep** — if we ever swap drizzle for
  another ORM, the migration touches every consumer. Acceptable;
  schema is the single rewrite point.
- **Server-only fields surfaced as omits** — every `Omit<ContactRow,
...>` is a place where we explicitly chose what NOT to send to
  clients. Documented per-type.
- **`drizzle-zod` is one more transitive dep**. ~20KB. Acceptable for
  the zero-drift benefit at API boundaries.

## What would make us reconsider

- **A non-DB type emerges as the source of truth** — e.g. a CRDT /
  PowerSync-side state shape that doesn't map cleanly to SQL. At
  that point the canonical type becomes the CRDT, and db types
  derive from it.
- **Drizzle major upgrades break inference** — if `$inferSelect`
  changes shape across versions, the cost of re-derivation
  outweighs the dedup benefit.

## Refs

- `tech-drizzle.spec.md` — ORM foundation
- `tech-api-rest-openapi.spec.md` — API contract that consumes these types
- `tech-powersync.spec.md` — future client-side state layer
