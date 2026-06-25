# Contributing to Rando.id

Thanks for the interest. This doc covers what you need to get a local
checkout running, how to run tests, and how to land changes.

For cloud-side concerns (Vercel/Neon/Clerk setup, deploys, environments,
DNS), see [MAINTAINING.md](./MAINTAINING.md). For the patterns we work
by — adapter pattern, soft-skip orchestration, commit conventions — see
[CLAUDE.md](../CLAUDE.md).

## Prereqs

- **Node 22**, **pnpm 10** — installed by `brew bundle install` (Brewfile at `scripts/Brewfile`)
- **Docker Desktop or OrbStack** — also from the Brewfile
- **Clerk dev account** — free at [clerk.com](https://clerk.com), used for the per-app `.env` keys

## Quickstart

```bash
git clone https://github.com/rando-id/rando.id.git && cd rando.id
./scripts/bootstrap
```

`./scripts/bootstrap` chains seven idempotent steps:

1. `brew bundle install` — system deps (includes `direnv` for step 3a)
2. `pnpm install` — JS deps + husky hook regeneration
3. Symlink `rando` into `~/.local/bin`
   3a. `direnv allow` — authorize `.envrc` so `.env` auto-exports when you `cd` into the repo
4. `docker compose up -d` — Postgres + PostGIS
5. `pnpm --filter @rando/db db:migrate` — schema + PostGIS enable
6. `rando init` — env var setup, ends with a doctor sweep

Re-running is safe — every step is a no-op when already done.

**Linux/Windows:** skip the Brewfile, install equivalents however you
manage packages, then run the inner steps manually:

```bash
pnpm install
node scripts/setup-cli.mjs
direnv allow .                       # if you installed direnv — see below
docker compose up -d
DATABASE_URL=postgres://rando:rando@localhost:5432/rando \
  pnpm --filter @rando/db db:migrate
rando init
```

### Shell hook for direnv

`direnv allow` only takes effect once your shell has the `direnv hook`
loaded — that's a one-time edit to your rc file. Pick the matching
line for your shell and add it:

```bash
echo 'eval "$(direnv hook zsh)"'  >> ~/.zshrc
echo 'eval "$(direnv hook bash)"' >> ~/.bashrc
echo 'direnv hook fish | source'  >> ~/.config/fish/config.fish
```

Restart your shell after. From then on, `cd rando.id` auto-exports
every variable in your `.env` — required for the Neon MCP server (and
any direct `pnpm exec …` calls that need `NEON_API_KEY` /
`VERCEL_TOKEN` / etc. outside the `rando` bin wrapper). The bootstrap
script prints the same hint when it detects the hook isn't installed.

Once the hook is loaded, you'll see a `direnv: loading …/.envrc` line
every time you start a shell inside the repo (or `cd` into it). That's
direnv announcing which variables it exported — normal, not an error.
To silence those status lines without disabling direnv, add
`export DIRENV_LOG_FORMAT=""` to your rc file.

## 1Password integration (required path)

Rando treats **1Password as the source of truth for every secret**;
the `.env` files (one at the repo root, one in each app) are just
local caches scoped by each context's `.env.example`. The CLI uses
three 1Password **Environments** — one per deploy environment — so
`local` / `staging` / `prod` credentials can't cross-contaminate.

### Environments (NOT Vaults — read this twice)

1Password has two distinct features that look related but aren't:

- **Vaults** — the standard container, the one you've probably used. Items live here, each with custom fields (`username`, `password`, `credential`, custom-named, etc.). Referenced as `op://<vault-id>/<item>/<field>`.
- **Environments** — a SecretMgr feature, **flat KEY=VALUE pairs**. No items, no fields, no titles — just a bundle of env vars. Read in bulk via `op environment read <env-id>` (dumps `KEY=VALUE` lines). `op://<env-id>/...` syntax does **not** work — the op CLI rejects with "This operation cannot be performed on 1Password Environments."

Rando uses **Environments** for the deploy-env credential bundles
(`local` / `staging` / `prod`) because:

1. Service accounts can be scoped to a single Environment for safety
2. CI workflows want everything-at-once via `op environment read`, not per-secret lookups
3. The KEY=VALUE-only model matches how env vars actually work

Account UUID + Environment IDs pinned in `rando.config.json` →
`secrets.environments`.

How they're accessed:

- **Locally** (user-account auth via biometric integration): `rando secrets sync` pulls all vars at once via `op environment read` and writes to `.env`. Individual reads happen the same way under the hood — there's no `op read op://<env-id>/<var>/credential` path because Environments don't have items/fields.
- **In CI** (service account): `.github/actions/op-env` runs `op environment read <env-id>` and pipes the output to `$GITHUB_ENV`, making every variable available to subsequent workflow steps.

### One-time per machine

First, enable biometric-driven CLI auth in the 1Password desktop app —
otherwise your `op` session expires every ~10 minutes idle:

1. Open the 1Password desktop app
2. Settings → **Developer** → tick **Integrate with 1Password CLI**
3. Same panel → **Connect with 1Password CLI** (or equivalent biometric integration)
4. Settings → Security → confirm Touch ID (or your biometric) is on

Then:

```bash
op signin            # one-time interactive sign-in
rando doctor         # confirm "Secrets: signed in as <you>"
rando secrets sync   # pull every configured var from the local 1P env into .env
```

### Convention

Each variable inside an Environment is named exactly as the env var
name — `NEON_API_KEY`, `VERCEL_TOKEN`, `POSTMAN_API_KEY`, etc. No
titles, no fields, just `KEY = value` pairs. Adding a new env var
means adding a new variable with that name to whichever Environment(s)
need it, via either the 1Password desktop app (Developer →
Environments → click in → "Add variable") or `rando secrets set <name>`.

The exception: `OP_SERVICE_ACCOUNT_TOKEN` itself lives in a **Vault**
(your Personal vault, typically), not an Environment — it's the
credential the service account uses to _read_ Environments, so it
can't itself live inside one. See
[Bootstrapping `OP_SERVICE_ACCOUNT_TOKEN` for CI](#bootstrapping-op_service_account_token-for-ci)
below for the full setup.

### Adding a secret across environments

```bash
# Interactive — prompts for the value (masked) + which envs to write to:
rando secrets set NEW_SECRET

# Non-interactive — single env:
rando secrets set NEW_SECRET --value "$(cat /tmp/the-value)" --env local

# Non-interactive — all three envs at once with the same value:
rando secrets set NEW_SECRET --value "$(cat /tmp/the-value)" --all
```

After `set`, the value lives in 1Password but not yet in your local
`.env`. Run `rando secrets sync` to pull it down.

### Pulling a different environment's values locally

```bash
rando secrets sync --env staging
rando secrets sync --env prod --force   # overwrites .env with prod values (careful!)
```

### Setting up 1Password from scratch

Skip this section if you're joining an existing project — the
environments already exist. **Only needed when forking Rando or
recreating the 1Password side from zero.**

1. **Find your account UUID:**

   ```bash
   op signin
   op account list --format=json | jq '.[] | {url, email, account_uuid}'
   ```

   Copy the **`account_uuid`** (NOT `user_uuid` — they look identical
   in op's output but only `account_uuid` works as a `--account`
   identifier). `rando doctor` validates the pinned value and will
   tell you if you got it wrong.

2. **Create three Environments** in the 1Password desktop app
   (Developer panel → Environments → New Environment). Suggested
   names: `Rando — local`, `Rando — staging`, `Rando — prod`.

3. **Get the Environment IDs:**

   ```bash
   op environment list --format=json | jq '.[] | {id, name}'
   ```

4. **Update `rando.config.json` → `secrets`** with the account UUID
   and the three environment IDs.

5. **Populate each Environment** with one entry per env var, named
   literally with the var name (`NEON_API_KEY`, `VERCEL_TOKEN`, etc.).
   Use the desktop UI or `rando secrets set NEW_VAR --all`.

6. **Verify:**

   ```bash
   rando secrets sync
   rando doctor
   ```

### Bootstrapping `OP_SERVICE_ACCOUNT_TOKEN` for CI

GitHub Actions uses a 1Password service account to read environments
non-interactively. One repo secret — `OP_SERVICE_ACCOUNT_TOKEN` — and
every workflow resolves the rest.

1. Create a service account at <https://my.1password.com/developer-tools/infrastructure-secrets/serviceaccount>. Scope it to **both** the **staging** AND **production** environments with **read** access — every preview, staging, and production deploy workflow uses this same `OP_SERVICE_ACCOUNT_TOKEN`, and `deploy-production.yml` explicitly reads the prod environment. 1Password shows the token (`ops_...`) once — copy it.
2. Stash the token in 1Password (your Personal vault, since it's a CI bootstrap secret) as `OP_SERVICE_ACCOUNT_TOKEN` with field `credential`.
3. Push it to GitHub via `rando secrets push`:

   ```bash
   rando secrets push OP_SERVICE_ACCOUNT_TOKEN \
     --ref op://Personal/OP_SERVICE_ACCOUNT_TOKEN/credential
   ```

4. **Rotating:** generate a new token, update the 1P item, re-run the
   same push.

### Opting out

`rando init --no-1password` skips the vault lookup and prompts
interactively for every value.

## Per-app `.env` files for Clerk

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

Once the values exist in your 1Password `local` environment,
`rando secrets sync` is the canonical way to refresh every `.env`.

## Dev commands

```bash
pnpm dev                              # all apps via Turbo
pnpm --filter @rando/api    dev       # API only       (port 4000)
pnpm --filter @rando/web    dev       # web only       (port 3000)
pnpm --filter @rando/admin  dev       # admin only     (port 3100)
pnpm --filter @rando/native dev       # Expo dev tools

pnpm typecheck                        # all 15 workspaces
pnpm test                             # all packages with tests
pnpm --filter @rando/db db:generate   # after schema changes
pnpm --filter @rando/db db:reset      # drop + migrate + seed
```

## Optional: seed sample data

```bash
pnpm --filter @rando/db db:seed
```

1 user, 5 SoCal locations, 10 contacts, 2 lists. Skip for empty databases.

## Optional: expose API for Clerk webhooks (local)

To receive Clerk webhooks against your local API, start the Cloudflare
Tunnel profile (needs `CLOUDFLARE_TUNNEL_TOKEN` in the root `.env`):

```bash
docker compose --profile tunnel up -d
docker logs rando-cloudflared   # should show "Registered tunnel connection"
```

Verify the tunnel reaches your local apps (each app must be running):

```bash
curl -i https://dev-api.rando-id.dev/v1/health   # expect 200
curl -i https://dev-web.rando-id.dev             # expect 200
curl -i https://dev-admin.rando-id.dev           # expect 200
```

The tunnel exposes your local apps at `dev-*.rando-id.dev` so webhook
providers (Clerk etc.) can reach you. Cloudflare-side setup of the
tunnel itself lives in [MAINTAINING.md](./MAINTAINING.md#cloudflare).

## Wiring a local Clerk webhook

1. Clerk dashboard → Webhooks → Add Endpoint
2. URL: `https://dev-api.rando-id.dev/v1/webhooks/clerk`
3. Subscribe to: `user.created`, `user.updated`, `user.deleted`
4. Open the endpoint → copy the **Signing Secret** (starts with `whsec_`)
5. In `apps/api/.env`: `CLERK_WEBHOOK_SECRET=whsec_...`
6. Restart the API dev server
7. From the webhook endpoint page → **Send Event** → `user.updated` → pick a test user → send. The API terminal should log `POST /v1/webhooks/clerk 200`.

## API testing — Postman CLI

The canonical API test loop is **collection-as-code**: the Postman
collection JSON lives at `postman/rando-api.postman_collection.json`
with hand-authored `pm.test()` assertions, run by the official
Postman CLI (locally + in CI) and mirrored to Postman desktop (for
UI exploration).

```bash
# Run tests against your local API:
pnpm --filter @rando/api dev      # terminal 1
pnpm test:api                     # terminal 2

# Hit a deployed env:
BASE_URL=https://staging-api.rando-id.dev pnpm test:api

# Inject 1Password secrets (when authed tests land):
op run --env-file=postman/.op.env -- pnpm test:api

# Mirror the local collection to your Postman workspace. Also pushes
# the OpenAPI spec into Postman's Spec Hub (the spec-shaped sidebar
# view, separate from the collection) so docs/governance stay anchored
# to the contract. Spec Hub works on the Postman Free tier.
rando api postman sync

# Push only the spec (skip the collection half). Default --target is
# `spec` (Spec Hub). Use --target api to push to the API Builder
# entity instead (paid feature; returns "upgrade required" on Free).
rando api postman push-spec
rando api postman push-spec --target api      # paid-tier API Builder push

# Regenerate the collection skeleton from the OpenAPI spec.
# IMPORTANT: refuses to overwrite without --force — generate to a
# temp path first and merge changes manually so hand-authored tests
# aren't wiped.
rando api postman generate --out /tmp/new-collection.json
diff postman/rando-api.postman_collection.json /tmp/new-collection.json
```

### Spec linting

Two lints, by design:

```bash
# Static (offline) — renders the spec from the contract, runs Spectral
# with the rules in `.spectral.yaml`. No dev server, no network.
# Enforces Rando-specific rules: every operation tagged + has a
# summary, every 4xx/5xx response uses $ref to components.responses,
# bearerAuth declared. Gated on the `api` aggregate in lint.yml.
pnpm spec:lint:static

# Live (against a running API) — runs `postman api lint` against the
# served /v1/openapi.json. Uses Postman Cloud's OWASP / OAS ruleset.
# Catches things Spectral's defaults don't (security best-practices,
# governance rules from Postman). Gated on preview-deploy readiness in
# integration-tests.yml; locally requires the dev server.
pnpm spec:lint
```

The static lint is the fast gate (~5s, runs on every PR with an API
change). The live lint is the depth gate (runs once the preview URL
comes up). Both must pass before merge.

## End-to-end demo flow

Once Docker is up, DB seeded, and Clerk keys in place:

1. `pnpm --filter @rando/api dev` (terminal 1)
2. `pnpm --filter @rando/web dev` (terminal 2)
3. Open `http://localhost:3000/sign-in` → create an account
4. Sync your Clerk user → either configure a webhook (above) or re-run seed with your real Clerk id: `SEED_CLERK_ID=user_xxx pnpm --filter @rando/db db:reset`
5. Visit `http://localhost:3000/contacts` → allow geolocation → distance-sorted list

## Conventions

- **Commit messages:** `feat(scope):` / `fix(scope):` / `chore(scope):` with a one-line subject. Short body if it adds context. Include `Co-Authored-By:` for assisted work.
- **Pre-commit hook:** husky + lint-staged run ESLint + Prettier against staged files before each commit. The same checks run in CI. Auto-installed by `pnpm install` via the root `prepare` script.
- **Bypassing the hook:** `git commit --no-verify` skips it. Use only on intentionally-broken WIP branches — never on `main` or `staging`.
- **Adapter pattern for any 3rd-party service.** New vendor integrations go in `packages/cli/src/domain/X.ts` (interface) + `packages/cli/src/adapters/X.ts` (impl). See [CLAUDE.md](../CLAUDE.md) for the full conventions.
- **`.env.example` is the per-context contract** for which env vars an app declares. Adding a var to an app means editing its `.env.example` — `rando secrets sync` and the orchestrator both pick it up automatically.

## Filing issues + opening PRs

- **Bugs / feature requests:** use the [issue templates](./ISSUE_TEMPLATE/). For security-sensitive reports, follow [SECURITY.md](./SECURITY.md) instead — do not file a public issue.
- **PRs:** the [PR template](./PULL_REQUEST_TEMPLATE.md) prompts for the summary, test plan, and ticket reference. Reference the ticket as `Closes #N` / `Refs #N` in the description.
- **CI:** typecheck + lint run on every push. Human-authored PRs get a Vercel preview URL automatically.

### Previews for Dependabot PRs (opt-in)

To preserve Vercel's free-tier quota (100 deploys/day) for human work,
**Dependabot PRs skip the preview deploy by default**. Validation comes
from unit tests + the nightly `integration-tests.yml` run against
staging. If you're reviewing a Dependabot PR that genuinely needs a
preview — typically tamagui / next / react / clerk majors where unit
tests can't tell the whole story — add the `deploy-preview` label:

```bash
gh pr edit <N> --add-label deploy-preview
```

The next sync (push to the branch, comment-rebase, or an empty commit
trigger) fires the deploy. The `deploy-preview` label persists across
rebases, so subsequent syncs continue to deploy until you remove it
or the PR closes. Spec: [`.notes/ci-preview-quota-strategy.spec.md`](../.notes/ci-preview-quota-strategy.spec.md).

## Code of Conduct

Participation in this project is governed by the
[Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). Report
unacceptable behavior to `conduct@rando.id`.

## What's still rough

- PowerSync (stub package only)
- Sentry + PostHog init in apps (event names defined, init not wired)
- Storybook
- Playwright + MSW integration tests
- Most product features beyond "list contacts by distance"
