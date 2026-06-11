# Rando.id

Contacts organized by **where you met them**, not by name.

See [SPEC.md](./SPEC.md) for the product spec and locked technical decisions.

## Getting started

- [DEVELOPER_SETUP.md](./DEVELOPER_SETUP.md) — prerequisites, env config,
  local infrastructure, the Clerk webhook tunnel, end-to-end smoke test.
- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) — GitHub, Vercel, CI, prod
  webhooks, deployment.

## Layout

```
apps/
  api/         Next.js — public REST/OpenAPI surface (port 4000)
  web/         Next.js — user-facing web app (port 3000)
  admin/       Next.js — Clerk-gated admin dashboard (port 3100)
  native/      Expo — iOS + Android
packages/
  ui/          Tamagui components (shared web + native)
  config/      Themes, env schema, feature flags, subscription tiers
  db/          Drizzle schema + Postgres client + migrations + seed
  api-client/  Typed REST client (hand-rolled now, OpenAPI-generated later)
  sync/        PowerSync client + schema mirror (stub)
  auth/        Clerk webhook payload validation + shared user types
  maps/        Map/geocoding adapter (OSM today, swappable)
  observability/  Sentry + PostHog wrappers + analytics taxonomy
  testing/     MSW handlers + fixtures
tooling/
  tsconfig/    Shared TS configs (base, library, nextjs, expo)
  eslint-config/  Shared ESLint flat configs
```

## Architecture notes

- **Drizzle imports.** Always `import { ... } from '@rando/db'`, never from `drizzle-orm` directly. pnpm dedupes drizzle-orm by peer-dep signature; reaching into it directly causes type collisions.
- **Tamagui style props.** v4 enforces shorthand-only — use `p`, `py`, `px`, `bg`, `items`, `justify`, `mt`, `text`. Long forms (`padding`, `alignItems`, etc.) won't typecheck.
- **PostGIS migrations.** `pnpm db:generate` emits the schema, then we hand-unquote `"geography(POINT, 4326)"` → `geography(POINT, 4326)` in the SQL. `db:migrate` enables PostGIS before applying. Watch for this on future schema changes touching `locations.geo`.
- **React versions.** All apps run on React 19 (Expo 56 / RN 0.85 in native). `@types/react@19` is pinned via `pnpm.overrides` so types stay aligned across the workspace.

## Endpoints currently usable

- `GET /v1/health` — public, returns `{ ok: true, ... }`
- `GET /v1/openapi.json` — public, placeholder spec
- `GET /v1/contacts?near=<lat>,<lng>` — Clerk-protected, PostGIS-ordered contact list
- `POST /v1/webhooks/clerk` — Svix-signed, upserts users from Clerk events

## What's wired but not connected

- **PowerSync**: package stub only. Service + client setup is TODO.
- **Sentry / PostHog**: event names defined, init not wired into apps yet.
- **OpenAPI generation**: `/v1/openapi.json` is a placeholder. Wire `zod-openapi` or `@ts-rest` to make it real.
- **Storybook + Playwright + CI**: not started.

See [SPEC.md](./SPEC.md) §5 for the phased feature plan.
