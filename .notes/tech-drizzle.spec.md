---
status: approved # draft → proposed (issue filed) → approved (milestone attached)
issue: 270
---

# Drizzle ORM + Drizzle Kit — schema + queries + migrations

## Decision

Drizzle ORM for query building, Drizzle Kit for migrations.
Schema lives in `packages/db/src/schema.ts`. Every consumer
imports from `@rando/db`, never directly from `drizzle-orm`.

## Why

- **SQL-shaped.** Drizzle's API maps 1:1 to SQL — `select().from().where().leftJoin()` reads like the SQL it generates. Easier to reason about query plans + tune indexes.
- **Type inference end-to-end.** Schema → query → result. No code generation step needed for types.
- **Edge-runtime safe.** Drizzle is tiny + ESM-pure. Works in Vercel Edge functions where Prisma's binary engine can't go.
- **Drizzle Kit's migration story.** `db:generate` from schema; we hand-tune the SQL before applying. PostGIS-touching migrations need a manual unquote step (`"geography(POINT, 4326)"` → `geography(POINT, 4326)`), but that's a one-line fix per migration, not a Drizzle problem.
- **No N+1 trap from "lazy" relations.** Drizzle is explicit; if you wrote a single query, that's what runs.

## Options considered

- **Prisma** — best DX overall, but: edge-runtime story has been bumpy (binary engine, then WASM, then Rust port), N+1 traps in `include`, has-to-be-Postgres-compatible (rules out raw SQL extensions cleanly), and the migration tool wants ownership over what's not always your call.
- **Kysely** — also SQL-shaped + type-safe, also great. Lost on: migration tooling is bring-your-own; Drizzle's `db:generate` is built-in. Otherwise close call.
- **Raw `pg` + hand-written queries** — defensible at small scale. Loses on type safety, refactor velocity.
- **TypeORM / Sequelize** — declarative-class-style ORMs. Old patterns, less alignment with where TS has gone.

## What we accept

- **Drizzle is younger than Prisma.** Smaller community, occasional rough edges in advanced queries (window functions, recursive CTEs).
- **Dedup gotcha:** drizzle-orm is a peer dep; we MUST import via `@rando/db` to avoid duplicate copies of drizzle-orm in the workspace. Documented in CLAUDE.md gotchas.
- **PostGIS migration quirk** (the geography type quote) is a manual touch per affected migration.

## What would make us reconsider

- Drizzle stops being actively maintained or has a major breaking change we can't follow.
- We need a feature that genuinely requires Prisma's metadata (Studio, Pulse for change streams, etc).
- Migration generation gets in our way more than it helps.
