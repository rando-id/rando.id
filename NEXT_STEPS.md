# Next steps — running Rando.id locally

## Prereqs

- Node 22, pnpm 10 (already installed)
- Docker Desktop **running**
- Clerk dev account (free at clerk.com) for keys

## First-time setup

```bash
cd /Users/archives/Code/rando/rando

# 1. Start Postgres + PostGIS
docker compose up -d

# 2. Set DB URL (current shell only, or add to apps/api/.env.local)
export DATABASE_URL='postgres://rando:rando@localhost:5432/rando'

# 3. Apply schema (enables PostGIS, runs migration)
pnpm --filter @rando/db db:migrate

# 4. Seed sample data — 1 user, 5 SoCal locations, 10 contacts, 2 lists
pnpm --filter @rando/db db:seed

# 5. Copy env templates
cp apps/api/.env.example   apps/api/.env.local
cp apps/web/.env.example   apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp apps/native/.env.example apps/native/.env.local
```

Then fill in the `.env.local` files with real values:

- `DATABASE_URL=postgres://rando:rando@localhost:5432/rando` → `apps/api/.env.local`
- Clerk publishable key → every `.env.local`
- Clerk secret key + webhook secret → `apps/api/.env.local`

## Dev commands

```bash
pnpm dev                              # all apps via Turbo
pnpm --filter @rando/api    dev       # API only       (port 4000)
pnpm --filter @rando/web    dev       # web only       (port 3000)
pnpm --filter @rando/admin  dev       # admin only     (port 3100)
pnpm --filter @rando/native dev       # Expo dev tools

pnpm typecheck                        # all 15 workspaces
pnpm --filter @rando/db db:generate   # after schema changes
pnpm --filter @rando/db db:reset      # drop + migrate + seed
```

## End-to-end demo flow

Once Docker is up, DB seeded, and Clerk keys are in place:

1. `pnpm --filter @rando/api dev` (terminal 1)
2. `pnpm --filter @rando/web dev` (terminal 2)
3. Open `http://localhost:3000/sign-in`, create an account
4. Sync your Clerk user to the DB — either:
   - Configure a Clerk webhook → `https://your-tunnel/v1/webhooks/clerk` (use ngrok/cloudflared for local), or
   - Re-run seed with your real Clerk id: `SEED_CLERK_ID=user_xxx pnpm --filter @rando/db db:reset`
5. Visit `http://localhost:3000/contacts` — allow geolocation — see the distance-sorted list

## What still needs work (post-commit)

- PowerSync service + offline-first wiring (currently a stub package)
- Sentry + PostHog init in each app (event names are defined, init isn't)
- OpenAPI generation (the `/v1/openapi.json` route is a placeholder spec)
- Storybook
- Playwright + MSW integration tests
- CI (GitHub Actions)
- All the product features beyond "list contacts by distance" — contact create form, list management, share/QR, themes, profile, admin dashboard
