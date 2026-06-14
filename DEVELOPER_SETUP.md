# Next steps — running Rando.id locally

## Quickstart

The recommended path is `./scripts/bootstrap` (see the [root README](./README.md) →
"Getting started"). It handles brew + pnpm + symlink + docker + db:migrate +
`rando init` in one command, all idempotent.

The sections below cover what's still manual after `bootstrap` finishes
(per-app `.env.local` files for Clerk keys), and they also document the
underlying steps for the rare case you want to reproduce bootstrap
piece-by-piece.

## Prereqs

- Node 22, pnpm 10 — installed by `brew bundle install` (Brewfile lives at `scripts/Brewfile`)
- Docker Desktop / OrbStack — also from the Brewfile
- Clerk dev account (free at clerk.com) for the per-app `.env.local` keys

## What `./scripts/bootstrap` already handles

```bash
# All of this is what `./scripts/bootstrap` runs for you:
pnpm install                                    # JS deps + husky hooks
node scripts/setup-cli.mjs                      # ~/.local/bin/rando symlink
docker compose up -d                            # Postgres + PostGIS
DATABASE_URL=postgres://rando:rando@localhost:5432/rando \
  pnpm --filter @rando/db db:migrate            # schema + PostGIS enable
rando init                                      # walks env vars + final doctor
```

Re-running `./scripts/bootstrap` is safe — every step is a no-op when
already done.

## Still manual after bootstrap

### 1. Seed sample data (optional)

```bash
pnpm --filter @rando/db db:seed
```

1 user, 5 SoCal locations, 10 contacts, 2 lists. Skip if you want
empty databases.

### 2. Per-app `.env.local` files for Clerk

`rando init` populates the **root** `.env` (used by docker-compose +
the CLI). The Next.js / Expo apps each need their own `.env.local`
with Clerk keys:

```bash
cp apps/api/.env.example   apps/api/.env.local
cp apps/web/.env.example   apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp apps/native/.env.example apps/native/.env.local
```

Then fill in:

- `DATABASE_URL=postgres://rando:rando@localhost:5432/rando` → `apps/api/.env.local`
- Clerk publishable key → every `.env.local`
- Clerk secret key + webhook secret → `apps/api/.env.local`

(Tracked as a backlog item: have `rando init` prompt for Clerk keys
and write the per-app `.env.local` files automatically.)

### 3. Optional: expose API for Clerk webhooks

To receive Clerk webhooks against your local API, start the Cloudflare
Tunnel profile (needs `CLOUDFLARE_TUNNEL_TOKEN` in root `.env`):

```bash
docker compose --profile tunnel up -d
```

See "Cloudflare Tunnel (dev webhooks)" below for the full setup.

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

Local apps are exposed at `dev-*.rando-id.dev` subdomains so you can avoid
typing `localhost` and so webhooks can reach you. The plain subdomains on
`rando-id.dev` (without the `dev-` prefix) are reserved for the staging
Vercel deployment — don't reuse them here. Replace `rando-id.dev` with your
own domain if you're forking.

### 1. One-time Cloudflare setup

1. **Zero Trust dashboard → Networks → Tunnels → Create a tunnel**
   - Connector type: **Cloudflared**
   - Environment when prompted: **Docker** (we run it inside compose, no need
     to copy the install command shown — we only need the **tunnel token**)
   - Name it `rando-dev` (or similar), copy the token
2. Under **Networks → Published Application Routes**, add **three** entries
   pointing at this tunnel (one per local app). Cloudflare also calls these
   "Tunnel Public Hostnames" in some places — same feature.

   | Subdomain   | Domain         | Type | URL                         | Access policy |
   | ----------- | -------------- | ---- | --------------------------- | ------------- |
   | `dev-web`   | `rando-id.dev` | HTTP | `host.docker.internal:3000` | Bypass        |
   | `dev-admin` | `rando-id.dev` | HTTP | `host.docker.internal:3100` | Bypass        |
   | `dev-api`   | `rando-id.dev` | HTTP | `host.docker.internal:4000` | Bypass        |

   Application type: **Self-hosted**. `dev-api` must be **Bypass** so Clerk
   webhooks can reach it; the others can optionally be Access-gated later.
   Cloudflare auto-creates the matching DNS records.

### 2. Per-developer setup

```bash
cp .env.example .env                       # at repo root
# Paste CLOUDFLARE_TUNNEL_TOKEN=... into .env
docker compose --profile tunnel up -d      # starts postgres + cloudflared
docker logs rando-cloudflared              # should show "Registered tunnel connection"
```

Verify the tunnel reaches your local apps (each app must be running on its
respective port):

```bash
curl -i https://dev-api.rando-id.dev/v1/health    # expect 200 + {"ok":true, ...}
curl -i https://dev-web.rando-id.dev              # expect 200 (homepage HTML)
curl -i https://dev-admin.rando-id.dev            # expect 200 (admin homepage HTML)
```

### 3. Wire the Clerk webhook (one-time)

1. **Clerk dashboard → Webhooks → Add Endpoint**
   - Endpoint URL: `https://dev-api.rando-id.dev/v1/webhooks/clerk`
   - Description: `Syncs Clerk user lifecycle events (created/updated/deleted) into the Rando API's local Postgres via the dev Cloudflare Tunnel (dev-api.rando-id.dev → host.docker.internal:4000). Separate webhook endpoints exist for staging and production — see INFRASTRUCTURE.md.`
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
