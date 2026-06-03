# Rando.id

Contacts organized by **where you met them**, not by name.

See [SPEC.md](./SPEC.md) for the product spec and locked technical decisions.

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

## Prerequisites

- Node 22 (see `.nvmrc`)
- pnpm 10
- Docker Desktop (running) — for local Postgres + PostGIS
- For native dev: Xcode (iOS) and/or Android Studio, or Expo Go on a phone
- Accounts: Clerk (dev keys), Neon (when deploying), Sentry, PostHog

## First-time setup

```bash
# 1. Install deps
pnpm install

# 2. Start Postgres + PostGIS
docker compose up -d
export DATABASE_URL='postgres://rando:rando@localhost:5432/rando'

# 3. Apply migrations (also enables the PostGIS extension)
pnpm --filter @rando/db db:migrate

# 4. Seed sample data
pnpm --filter @rando/db db:seed

# 5. Copy env templates
cp apps/api/.env.example   apps/api/.env.local
cp apps/web/.env.example   apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp apps/native/.env.example apps/native/.env.local
```

Fill in real values:

- `DATABASE_URL=postgres://rando:rando@localhost:5432/rando` in `apps/api/.env.local`
- Clerk publishable key in every `.env.local` that ships UI
- Clerk secret key + webhook secret in `apps/api/.env.local`

## Dev commands

```bash
pnpm dev                              # all apps via Turbo
pnpm --filter @rando/api dev          # just the API   (4000)
pnpm --filter @rando/web dev          # just web       (3000)
pnpm --filter @rando/admin dev        # just admin     (3100)
pnpm --filter @rando/native dev       # just native (Expo)

pnpm typecheck                        # all workspaces
pnpm lint
pnpm build

pnpm --filter @rando/db db:generate   # generate migration from schema
pnpm --filter @rando/db db:migrate    # apply pending migrations
pnpm --filter @rando/db db:seed       # seed sample data
pnpm --filter @rando/db db:reset      # drop, re-migrate, re-seed
```

## Architecture notes

- **Drizzle imports.** Always `import { ... } from '@rando/db'`, never from `drizzle-orm` directly. pnpm dedupes drizzle-orm by peer-dep signature; reaching into it directly causes type collisions.
- **Tamagui style props.** v4 enforces shorthand-only — use `p`, `py`, `px`, `bg`, `items`, `justify`, `mt`, `text`. Long forms (`padding`, `alignItems`, etc.) won't typecheck.
- **PostGIS migrations.** `pnpm db:generate` emits the schema, then we hand-unquote `"geography(POINT, 4326)"` → `geography(POINT, 4326)` in the SQL. `db:migrate` enables PostGIS before applying. Watch for this on future schema changes touching `locations.geo`.
- **React versions.** Web/admin/api use React 19. Native uses React 18 at runtime (Expo 52 / RN 0.76) but `@types/react@19` is pinned via `pnpm.overrides` so types match across the workspace.

## What's wired but not connected

- **Clerk**: code is in place; needs real keys in `.env.local` files and a webhook configured to `POST /v1/webhooks/clerk` from your Clerk dashboard.
- **PowerSync**: package stub only. Service + client setup is TODO.
- **Sentry / PostHog**: event names defined, init not wired into apps yet.
- **OpenAPI generation**: `/v1/openapi.json` is a placeholder. Wire `zod-openapi` or `@ts-rest` to make it real.
- **Storybook + Playwright + CI**: not started.

## Endpoints currently usable

- `GET /v1/health` — public, returns `{ ok: true, ... }`
- `GET /v1/openapi.json` — public, placeholder spec
- `GET /v1/contacts?near=<lat>,<lng>` — Clerk-protected, PostGIS-ordered contact list
- `POST /v1/webhooks/clerk` — Svix-signed, upserts users from Clerk events

## End-to-end demo

Once Docker is up and `.env.local` files have Clerk keys + DATABASE_URL:

1. `pnpm --filter @rando/db db:reset` — fresh schema + 10 sample contacts at 5 SoCal locations
2. `pnpm --filter @rando/api dev`
3. `pnpm --filter @rando/web dev` → open `http://localhost:3000/sign-in`, sign up
4. The Clerk webhook (if configured) will sync your user to the DB; alternately, manually update `users.clerk_id` in Postgres to match your Clerk user, or re-run seed with `SEED_CLERK_ID=user_xxx`
5. Visit `http://localhost:3000/contacts` — distance-sorted list, GPS-aware

See [SPEC.md](./SPEC.md) §5 for the phased feature plan.
