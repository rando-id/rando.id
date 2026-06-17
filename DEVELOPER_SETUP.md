# Next steps — running Rando.id locally

## Quickstart

The recommended path is `./scripts/bootstrap` (see the [root README](./README.md) →
"Getting started"). It handles brew + pnpm + symlink + docker + db:migrate +
`rando init` in one command, all idempotent.

The sections below cover what's still manual after `bootstrap` finishes
(per-app `.env` files for Clerk keys), and they also document the
underlying steps for the rare case you want to reproduce bootstrap
piece-by-piece.

## Prereqs

- Node 22, pnpm 10 — installed by `brew bundle install` (Brewfile lives at `scripts/Brewfile`)
- Docker Desktop / OrbStack — also from the Brewfile
- Clerk dev account (free at clerk.com) for the per-app `.env` keys

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

## 1Password integration (required path)

Rando treats **1Password as the source of truth for every secret**;
the `.env` files (one at the repo root, one in each app) are just
local caches scoped by each context's `.env.example`. The CLI uses three 1Password **Environments** — one per
deploy environment — so local/staging/prod credentials can't
cross-contaminate.

### Environments (NOT Vaults — read this twice)

1Password has two distinct features with similar names:

- **Vaults** — the standard container. Items live here. Referenced as
  `op://<vault-id>/<item>/<field>`. Service accounts read from vaults.
- **Environments** — a SecretMgr feature that groups items by deploy
  environment. Referenced as `op://<env-id>/...` (user accounts only)
  or read in bulk via `op environment read <env-id>` (works for
  service accounts).

Rando uses **Environments** because the local/staging/prod separation
maps cleanly onto them, and service accounts can be scoped to a
single environment for safety. The IDs below are environment IDs,
not vault IDs.

| Env       | 1Password Environment ID     | Used by                                                 |
| --------- | ---------------------------- | ------------------------------------------------------- |
| `local`   | `jkimas55rfb5pr3g6xqwuejrpy` | `rando init`, `rando secrets sync` (default), local dev |
| `staging` | `ftd3n4l5egcfjai7f7tm2f7ytq` | `.github/workflows/*` via `op environment read`         |
| `prod`    | `ma4jp2piap7otpnnpvqmc4cgkq` | (future) production deploy workflows                    |

Account UUID + environment IDs are pinned in `rando.config.json` →
`secrets`. Every `op` invocation gets `--account <UUID>` so the right
account is always targeted even when multiple are signed in.

How they're accessed:

- **Locally** (user-account auth): `op read op://<env-id>/<item>/<field>`
  works because the user account transparently resolves environment
  references to their underlying items.
- **In CI** (service account): `op environment read <env-id>` dumps
  every secret as `KEY=VALUE` lines, which workflows pipe to
  `$GITHUB_ENV`. Service accounts can't use `op read op://<env-id>/...`
  — the action validator rejects it.

### Setting up 1Password from scratch

Skip this section if you're joining an existing project — the
environments already exist and `rando.config.json` already has the
IDs. **Only needed when forking Rando or recreating the 1Password
side from zero.**

1. **Find your 1Password `account_uuid`** (the one you're going to
   pin in `rando.config.json` → `secrets.account`):

   ```bash
   op signin
   op account list --format=json | jq '.[] | {url, email, account_uuid}'
   ```

   Copy the **`account_uuid`** (NOT `user_uuid` — they sit next to
   each other in op's JSON output and look identical, but only
   `account_uuid` works as a `--account` identifier). The output
   looks like:

   ```json
   {
     "url": "iamnewton.1password.com",
     "email": "1password@nwtn.email",
     "account_uuid": "PWOFKAZW3JFCLLMUD2WWDOSIXE"
   }
   ```

   `account_uuid` is fixed per-account and doesn't change as you add
   environments. `rando doctor` validates the pinned value matches a
   known account, so if you copy the wrong one by mistake, doctor will
   tell you (and even suggest the right `account_uuid` to swap in).

2. **Create three Environments** in the 1Password desktop app
   (Developer panel → Environments → New Environment). Name them
   however you like — only the IDs land in config. Suggested names:
   - `Rando — local`
   - `Rando — staging`
   - `Rando — prod`

3. **Get the Environment IDs**:

   ```bash
   op environment list --format=json | jq '.[] | {id, name}'
   ```

   Copy each ID. Environment IDs are stable — renaming doesn't
   change them, which is why we pin IDs not names.

4. **Update `rando.config.json` → `secrets`**:

   ```json
   "secrets": {
     "kind": "1password",
     "account": "<your-account-uuid>",
     "field": "credential",
     "environments": {
       "local": "<local-environment-id>",
       "staging": "<staging-environment-id>",
       "prod": "<prod-environment-id>"
     }
   }
   ```

5. **Populate each Environment** with one entry per env var, named
   **literally with the var name** (`NEON_API_KEY`, `VERCEL_TOKEN`,
   etc.). You can do this in the desktop UI, or programmatically once
   you have a few values handy:

   ```bash
   # Local environment, prompts for value:
   rando secrets set NEON_API_KEY --env local

   # All three environments at once with the same value:
   rando secrets set NEON_API_KEY --value "$(cat /tmp/the-key)" --all
   ```

6. **Create a service account** for CI at
   <https://my.1password.com/developer-tools/infrastructure-secrets/serviceaccount>
   and scope it to the **staging** Environment (read-only). The token
   is what ends up in GitHub as `OP_SERVICE_ACCOUNT_TOKEN` — push it
   via `rando secrets push OP_SERVICE_ACCOUNT_TOKEN --ref op://Personal/OP_SERVICE_ACCOUNT_TOKEN/credential`.

7. **Verify** by pulling into `.env`:

   ```bash
   rando secrets sync
   rando doctor   # Secrets row should show "signed in as <you> → 3 vault(s) configured"
   ```

### Finding IDs again later

Account UUID: `op account list --format=json | jq -r '.[].account_uuid'`
Environment IDs: `op environment list --format=json | jq -r '.[] | "\(.id)  \(.name)"'`
Vault UUIDs (rare): `op vault list --format=json | jq -r '.[] | "\(.id)  \(.name)"'`
Item references: in the desktop app → right-click → **Copy Secret Reference**.

### One-time per machine

**First**, enable biometric-driven CLI auth in the 1Password desktop
app (otherwise your `op` session expires every ~10 minutes idle and
every `rando` command starts failing until you sign in again):

1. Open the 1Password desktop app.
2. Settings → **Developer** → tick **"Integrate with 1Password CLI"**.
3. Same panel → make sure **"Connect with 1Password CLI"** (or
   equivalent biometric integration) is also enabled.
4. Settings → Security → confirm Touch ID (or your biometric) is on.

With those toggles, every `op` invocation that needs an unlocked
session pops a biometric prompt automatically — including the `op`
subprocesses that `rando` spawns. The `rando` CLI explicitly inherits
the parent shell's stdin so `op` can detect it's running in an
interactive terminal and trigger the prompt (a piped subprocess
without a TTY just gets "not signed in" with no chance to recover).

**Then:**

```bash
op signin                                 # one-time interactive sign-in (account binding)
rando doctor                              # confirm "Secrets: signed in as <you>"
rando secrets sync                        # pulls every configured var from the local vault into .env
```

### Convention

Items inside each vault are titled with the **literal env var name**;
the field on each item is `credential`. So `NEON_API_KEY` in the local
vault resolves to `op://jkimas55rfb5pr3g6xqwuejrpy/NEON_API_KEY/credential`.
Zero per-secret config — adding a new env var means creating an item
with that name in whichever vault(s) need it.

### Adding a secret across environments

```bash
# Interactive — prompts for the value (masked) + which envs to write to:
rando secrets set NEW_SECRET

# Non-interactive — write to a single env:
rando secrets set NEW_SECRET --value "$(cat /tmp/the-value)" --env local

# Non-interactive — write to all three envs at once (with the same value):
rando secrets set NEW_SECRET --value "$(cat /tmp/the-value)" --all
```

After `set`, the value lives in 1Password but not yet in your local
`.env`. Run `rando secrets sync` to pull it down.

### Pulling a different environment's values locally

The default is `--env local`. For debugging:

```bash
rando secrets sync --env staging --env-file .env.staging   # write to a sibling file
rando secrets sync --env prod --force                       # overwrite .env with prod values (careful!)
```

### CI side — bootstrapping `OP_SERVICE_ACCOUNT_TOKEN`

GitHub Actions uses the official [`1password/load-secrets-action`](https://github.com/marketplace/actions/install-1password-cli)
with a service account. The workflows reference vault items via
`op://...` URIs; the only thing GitHub itself needs to know is the
service-account token. **One** GitHub repo secret —
`OP_SERVICE_ACCOUNT_TOKEN` — and every workflow resolves the rest.

#### One-time bootstrap

1. **Create a service account** at
   <https://my.1password.com/developer-tools/infrastructure-secrets/serviceaccount>.
   Scope it to the **staging** vault with **read** access (add prod
   later when you have a production-deploy workflow). 1Password shows
   the token (`ops_...`) once at creation time — copy it.

2. **Stash the token in 1Password** so it has a home you can re-read
   later. Use your Personal vault (it's a bootstrap secret, not an
   app secret — doesn't belong in local/staging/prod):
   - In the 1Password desktop app: New Item → API Credential
   - Title: `OP_SERVICE_ACCOUNT_TOKEN`
   - Credential field: paste the `ops_...` token
   - Save in `Personal` (or wherever you keep CI-style secrets)

3. **Sign in to both CLIs**:

   ```bash
   op signin                          # 1Password — biometric unlock
   gh auth login                      # GitHub — interactive flow
   ```

4. **Push the token** from 1Password to GitHub repo secrets:

   ```bash
   rando secrets push OP_SERVICE_ACCOUNT_TOKEN \
     --ref op://Personal/OP_SERVICE_ACCOUNT_TOKEN/credential
   ```

   `rando secrets push` reads the value (piped via stdin so it never
   hits `ps` / shell history), then runs `gh secret set` against the
   repo from `rando.config.json`. Verify with `gh secret list`.

#### Rotating

Generate a new service-account token in 1Password's dashboard, update
the item value in the desktop app, then re-run the same push command.
GitHub sees an updated secret on the next workflow run.

#### Why not put `OP_SERVICE_ACCOUNT_TOKEN` in your local `.env`?

It bypasses the desktop biometric unlock and creates a long-lived
credential to babysit. Local dev uses `op signin` (interactive,
session-bounded); only CI uses the service-account token.

### Optional: 1Password shell plugin for `gh`

1Password has [shell plugins](https://www.1password.dev/cli/shell-plugins/github/)
that intercept `gh` calls and inject credentials from 1Password,
eliminating the need for `gh auth login` to cache a token in the
macOS keychain. With the plugin:

- Your GitHub PAT lives only in 1Password (no keychain copy).
- `rando secrets push` works the same — it just shells out to `gh`,
  the plugin transparently authenticates each call.
- Rotation is "update the item in 1P"; no `gh auth refresh` needed.

Setup is one command:

```bash
op plugin init gh
```

Worth it if you want the full "1Password is the only source of
credentials" property. Skip if `gh auth login` already works and you
don't want the extra setup. Either way, **CI workflows are
unaffected** — they use the service-account token via
`load-secrets-action`, not the local `gh` plugin.

### Opting out

`rando init --no-1password` skips the vault lookup entirely and falls
back to manual prompts. The `.env` cache works the same way; the only
difference is no auto-pull from 1Password.

## Still manual after bootstrap

### 1. Seed sample data (optional)

```bash
pnpm --filter @rando/db db:seed
```

1 user, 5 SoCal locations, 10 contacts, 2 lists. Skip if you want
empty databases.

### 2. Per-app `.env` files for Clerk

`rando secrets sync` populates every cache in one shot — the **root**
`.env` (used by docker-compose + the CLI) and one `.env` per app
under `apps/*`, each scoped by its own `.env.example`. If you'd
rather seed them by hand to start:

```bash
cp apps/api/.env.example   apps/api/.env
cp apps/web/.env.example   apps/web/.env
cp apps/admin/.env.example apps/admin/.env
cp apps/native/.env.example apps/native/.env
```

Then fill in:

- `DATABASE_URL=postgres://rando:rando@localhost:5432/rando` → `apps/api/.env`
- Clerk publishable key → every `.env`
- Clerk secret key + webhook secret → `apps/api/.env`

Once the values exist in your 1Password `local` environment,
`rando secrets sync` is the canonical way to refresh every `.env`.

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

pnpm test:api                         # postman-cli collection run against http://localhost:4000 (override w/ BASE_URL=...)
pnpm spec:lint                        # postman api lint against the live /v1/openapi.json
op run --env-file=postman/.op.env -- pnpm test:api   # inject auth token from 1Password (needed once authed tests land)
rando api postman generate            # regenerate postman/rando-api.postman_collection.json from the spec
rando api postman push                # push local collection + env JSONs into your Postman workspace

rando secrets sync                    # pull every configured token from 1Password (local vault) into .env
rando secrets sync --env staging      # pull from the staging vault instead
rando secrets set NEW_KEY --all       # store a new secret in every configured env vault
```

## API testing — Postman CLI + 1Password

The canonical API test loop is **collection-as-code**: the Postman
collection JSON lives at `postman/rando-api.postman_collection.json`
with hand-authored `pm.test()` assertions, run by the official
Postman CLI (locally + in CI) and mirrored to Postman desktop (for
UI exploration). The same CLI also lints the OpenAPI spec
(`postman api lint`) — drift / breaking changes get caught before
merge. 1Password provides the auth tokens at runtime via the `op` CLI.

### First-time setup

```bash
# 1. CLI tools — both already in scripts/Brewfile, install if you skipped:
brew bundle install --file=scripts/Brewfile   # picks up 1password-cli + the rest
brew install --cask postman                   # desktop app (optional, only for UI exploration)

# 2. Confirm `op` is logged in:
op account list                               # should show your 1Password account(s)
op signin                                     # if list is empty / session expired

# 3. Workspace id — only needed if you want to push to Postman desktop.
#    Open rando.config.json and set "postman": { "workspaceId": "<your-ws-id>" }.
#    Find the id in Postman desktop: workspace dropdown → ⓘ → copy id from the URL bar.

# 4. (Optional, only needed when authed tests land) per-developer 1Password references:
cp postman/.op.env.example postman/.op.env
$EDITOR postman/.op.env                       # adjust the op:// path to your vault layout
```

### Daily usage

```bash
# Just run the tests against your local API:
pnpm --filter @rando/api dev                  # terminal 1
pnpm test:api                                 # terminal 2

# Hit a deployed env instead:
BASE_URL=https://staging-api.rando-id.dev pnpm test:api

# Inject 1Password secrets (only matters once you have authed tests):
op run --env-file=postman/.op.env -- pnpm test:api

# Mirror the local collection + env JSONs to your Postman workspace
# (so you can browse + edit in the desktop UI). Uses PUT to keep
# uids stable — Postman Monitors / shared links won't break:
rando api postman push

# Regenerate the collection skeleton from the OpenAPI spec.
# IMPORTANT: this refuses to overwrite without --force because it
# would wipe your hand-authored pm.test() blocks. Generate to a
# temp path first and merge changes manually.
rando api postman generate --out /tmp/new-collection.json
diff postman/rando-api.postman_collection.json /tmp/new-collection.json
```

### 1Password vault layout

Personal Pro / Family / Business 1Password accounts all work the
same — the `op` CLI doesn't care which tier you're on. Create one
item per environment under whichever vault you already use for dev
secrets (or make a dedicated `Rando` vault for clarity):

| Vault                   | Item                  | Field        |
| ----------------------- | --------------------- | ------------ |
| `Rando` (or `Personal`) | `Rando API — dev`     | `credential` |
| `Rando` (or `Personal`) | `Rando API — staging` | `credential` |
| `Rando` (or `Personal`) | `Rando API — prod`    | `credential` |

Right-click an item in the 1Password desktop app and pick **Copy
Secret Reference** to get the URI. It looks like
`op://Rando/Rando API — dev/credential` — paste into `postman/.op.env`.
Different vault names per developer are fine; `.op.env` is gitignored
so it doesn't leak into the repo.

### Where each piece lives

- `postman/rando-api.postman_collection.json` — committed, source of truth, hand-authored tests on top of generated request shapes
- `postman/environments/{local,staging,prod}.postman_environment.json` — committed, `baseUrl` per env (and `authToken` placeholder, empty until authed tests land)
- `postman/.op.env.example` — committed, template showing the `op://` reference shape
- `postman/.op.env` — gitignored, per-developer vault paths
- `test-results/postman.xml` — gitignored, JUnit output from `pnpm test:api`
- `.github/workflows/api-tests.yml` — CI, runs `pnpm test:api` + `pnpm spec:lint` against PR preview URLs + nightly staging

### Postman desktop import (one-time, optional)

If you want to use the Postman desktop app for exploration (vs only
the CLI test loop):

1. Run `rando api postman push` once after setting `postman.workspaceId`.
   This pushes the collection + 3 environment JSONs.
2. Open Postman desktop → switch to the Rando workspace.
3. The collection + environments show up automatically; pick an env
   from the top-right dropdown.
4. Future pushes update in-place (stable uids) so any bookmarks /
   Monitor configurations you set up keep working.

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
3. In `apps/api/.env`:

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
