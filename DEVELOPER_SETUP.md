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
# (Optional — to expose the API publicly for Clerk webhooks etc., also start
# the Cloudflare Tunnel — requires CLOUDFLARE_TUNNEL_TOKEN in root .env. See
# "Cloudflare Tunnel (dev webhooks)" below.)
# docker compose --profile tunnel up -d

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

## Cloudflare Tunnel (dev webhooks)

Clerk and other webhook providers need a public URL to deliver events to your
local API. Rather than each developer installing `cloudflared` locally, the
tunnel runs inside Docker via a named Cloudflare Tunnel.

Current setup uses `api.rando-id.dev` as the dev tunnel hostname. Replace as
needed for your own domain.

### 1. One-time Cloudflare setup

1. **Zero Trust dashboard → Networks → Tunnels → Create a tunnel**
   - Connector type: **Cloudflared**
   - Environment when prompted: **Docker** (we run it inside compose, no need
     to copy the install command shown — we only need the **tunnel token**)
   - Name it `rando-dev` (or similar), copy the token
2. Open the tunnel → **Public Hostnames** → **Add a public hostname**
   - Subdomain: `api`
   - Domain: `rando-id.dev`
   - Type: `HTTP`
   - URL: `host.docker.internal:4000`
   - Save — Cloudflare auto-creates the DNS record

### 2. Per-developer setup

```bash
cp .env.example .env                       # at repo root
# Paste CLOUDFLARE_TUNNEL_TOKEN=... into .env
docker compose --profile tunnel up -d      # starts postgres + cloudflared
docker logs rando-cloudflared              # should show "Registered tunnel connection"
```

Verify the tunnel reaches your local API (API must be running on :4000):

```bash
curl -i https://api.rando-id.dev/v1/health
# expect 200 with {"ok":true, ...}
```

### 3. Wire the Clerk webhook (one-time)

1. **Clerk dashboard → Webhooks → Add Endpoint**
   - Endpoint URL: `https://api.rando-id.dev/v1/webhooks/clerk`
   - Description: `Syncs Clerk user lifecycle events (created/updated/deleted) into the Rando API's local Postgres via the dev Cloudflare Tunnel (api.rando-id.dev → host.docker.internal:4000). Replace with a production URL when the API is deployed.`
   - Subscribe to: `user.created`, `user.updated`, `user.deleted`
2. Open the endpoint → copy the **Signing Secret** (starts with `whsec_`)
3. In `apps/api/.env.local`:

   ```
   CLERK_WEBHOOK_SECRET=whsec_...
   ```

4. **Restart the API dev server** so it picks up the new secret.
5. From the webhook endpoint page in Clerk, click **Send Event** → choose
   `user.updated` → pick a test user → send. Watch your API terminal — you
   should see `POST /v1/webhooks/clerk 200`. That confirms signature
   verification + DB upsert worked.

### 4. Backfill existing Clerk users

Webhooks only fire on new events. To get existing Clerk users into the DB
without reseeding, either:

- Edit each user in the Clerk dashboard (any change triggers `user.updated`), or
- Use the webhook endpoint's **Send Event** button to manually deliver one
  `user.updated` per user.

## What still needs work (post-commit)

- PowerSync service + offline-first wiring (currently a stub package)
- Sentry + PostHog init in each app (event names are defined, init isn't)
- OpenAPI generation (the `/v1/openapi.json` route is a placeholder spec)
- Storybook
- Playwright + MSW integration tests
- CI (GitHub Actions)
- All the product features beyond "list contacts by distance" — contact create form, list management, share/QR, themes, profile, admin dashboard
