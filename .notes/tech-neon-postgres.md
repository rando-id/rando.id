# Postgres on Neon + PostGIS — database

## Decision

Neon-hosted Postgres for all environments (Docker locally, Neon
`staging` branch for staging Vercel, Neon `main` branch for prod).
PostGIS extension enabled on both branches for distance queries.

## Why

- **Neon's branching model is exactly what we need.** Per-PR DB branches via the Vercel integration; staging diverges from main without affecting it; copy-on-write keeps cost low.
- **PostGIS, not a separate spatial service.** The contacts feature ("sort by closest") needs real geographic distance queries with proper great-circle math + a geography index. PostGIS gives us this in one extension; alternatives (Algolia GeoSearch, MongoDB geo, etc) would mean a second data store to keep in sync.
- **Standard Postgres.** No proprietary query language. Drizzle works against any Postgres. Migrations work against any Postgres. If Neon disappears tomorrow, we restore the dump anywhere.
- **Vercel-managed integration.** Neon is in Vercel's marketplace; one-click provisioning from a Vercel project sets up the DB + injects `DATABASE_URL`. The CLI's `vercel install neon` flow uses this.
- **Serverless connection pooling.** Vercel functions are inherently bursty; Neon's pgbouncer handles the connection lifecycle natively.

## Options considered

- **Supabase** — also Postgres, also has PostGIS, also has branching. Loses on: pulls in Supabase Auth (we picked Clerk), pulls in Supabase Storage (we picked Vercel Blob), pulls in Supabase Edge Functions (we use Next.js route handlers). Bundling-by-default makes it harder to swap one piece later.
- **PlanetScale (MySQL)** — branching model is great but no PostGIS. We'd have to roll spatial queries by hand. Killer for our distance feature.
- **Vercel Postgres** — under the hood is Neon anyway (Neon partnership) — and historically less feature-complete on the branching side.
- **CockroachDB** — overkill for our scale, more expensive, distributed-by-default complexity we don't need.
- **Self-host on a Hetzner VPS** — possible, painful to maintain, no managed branching.

## What we accept

- **PostGIS-on-Neon quirk:** Neon's REST API has no SQL-execution endpoint, so `CREATE EXTENSION IF NOT EXISTS postgis;` has to happen via a real pg connection. `rando infrastructure setup` emits a manual note for this. Tracked at #79.
- **Connection pooling considerations.** Pooled vs unpooled URLs; we use pooled for app runtime, unpooled for migrations.
- **Branch creation requires endpoint provisioning.** Neon's API will create a "metadata-only" branch without a compute endpoint by default. Our `createBranch` adapter now passes `endpoints: [{ type: 'read_write' }]` so this is solved.

## What would make us reconsider

- Neon pricing surprises us at scale.
- We need a feature Postgres can't do well (graph queries, full-text search beyond `pg_trgm`, etc) → consider adding a specialized data store alongside, not replacing Postgres.
- Vercel's Neon integration evolves in a way that locks us in further than we want.
