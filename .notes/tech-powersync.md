# PowerSync — offline-first sync engine

## Decision

PowerSync for client-side offline-first sync from the native app
(and eventually web) against Postgres via logical replication.
Stub package today at `packages/sync`; full wiring tracked at #27.

## Why

- **Native-first offline.** Contacts app is location-aware; users will absolutely use it on flights, in tunnels, in dead zones. Need a real offline-first model, not "we cache the last view."
- **Postgres-native.** PowerSync uses Postgres logical replication as the source-of-truth feed, syncs to local SQLite on each client. No mirror DB, no eventually-consistent NoSQL store we'd have to reconcile.
- **Schema mirror lives in TypeScript.** Define your sync rules + client schema once, get type-safe queries on the local SQLite.
- **Conflict resolution is application-controlled.** Last-write-wins by default, but you can override per-table.
- **React Native + web SDKs.** Same model on both platforms.

## Options considered

- **ElectricSQL** — closest competitor, also Postgres-replication-based. Lost on: PowerSync's RN SDK was more mature at decision time + the auth/access-control model fit ours (Clerk JWT → row-level access rules) more naturally.
- **Replicache** — great client-side framework, but BYO sync layer on the server. We'd build half of PowerSync ourselves.
- **Custom: Postgres LISTEN/NOTIFY + SQLite mirror on client** — defensible for a tiny dataset, falls apart at any scale.
- **No offline-first; everything is online + cached** — possible but the product feels worse, and contacts are exactly the kind of data users expect to have offline.

## What we accept

- **Vendor lock for the sync layer.** PowerSync is a managed service; if we leave we own the rebuild. Tradeoff for not building it ourselves.
- **It's a Tier-1 feature we haven't wired yet.** Stub package only. The dependency is paid for in `packages/sync` placeholder code, real work is #27.
- **Logical replication adds DB load.** Real, manageable. Neon handles the replication slot.

## What would make us reconsider

- ElectricSQL closes the SDK-maturity gap AND undercuts on price.
- Our offline story turns out to be more modest than we thought → a simpler client-cache layer would do.
- PowerSync pricing flips bad before we're paying for it from real revenue.
