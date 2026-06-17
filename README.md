# Rando.id

Contacts organized by **where you met them**, not by name.

See [specs/apps.md](./specs/apps.md) for the product spec and locked technical decisions.

## Getting started

**Brand-new machine** (macOS):

```bash
# One-time prereq — skip if you already have Homebrew.
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Per-clone:
git clone https://github.com/rando-id/rando.id.git && cd rando.id
./scripts/bootstrap
```

`./scripts/bootstrap` chains six idempotent steps into one command:

1. **`brew bundle install`** — system deps from `scripts/Brewfile`
   (gh, pnpm, node@22, 1password-cli, orbstack — plus a couple of
   optional commented-out lines).
2. **`pnpm install`** — JS deps + husky regenerates the git hook
   shims via the `prepare` script.
3. **Symlinks `rando`** into `~/.local/bin` so subsequent commands
   work without the `pnpm` prefix.
4. **`docker compose up -d`** — Postgres + PostGIS container.
5. **`pnpm --filter @rando/db db:migrate`** — applies the schema +
   enables PostGIS.
6. **`rando init`** — pulls every configured env-var from your local
   1Password vault (after `op signin`), or prompts interactively for
   anything missing. Validates each by calling the vendor API,
   writes to `.env`, then ends with a doctor sweep + "next steps"
   menu. Pass `--no-1password` to skip the vault entirely.

After `init` finishes:

```bash
rando dev                          # local orchestrator: tunnel + 3 apps
pnpm --filter @rando/db db:seed    # (optional) load sample data — 1 user, 5 places, 10 contacts, 2 lists
rando doctor                       # re-check health anytime
rando secrets set NEW_VAR --all    # add a new secret to every env vault at once
rando secrets sync                 # re-pull from the local 1P vault into .env
```

**Secrets live in 1Password, not `.env`.** Rando uses three 1P
Environments (local / staging / prod) and the `.env` files are just
working caches populated by `rando secrets sync`. See
[.github/CONTRIBUTING.md → 1Password integration](./.github/CONTRIBUTING.md#1password-integration-required-path)
for the full convention + CI side.

**Linux / Windows**: skip the Brewfile, install equivalents however
you manage packages, then run the inner steps manually:

```bash
pnpm install
node scripts/setup-cli.mjs
docker compose up -d
DATABASE_URL=postgres://rando:rando@localhost:5432/rando \
  pnpm --filter @rando/db db:migrate
rando init
```

**Per-app `.env` files** (Clerk keys, app-specific config) are
written by `rando secrets sync` — one per app under `apps/*`,
scoped by each app's `.env.example`. See
[.github/CONTRIBUTING.md](./.github/CONTRIBUTING.md) for the deeper details
on the Clerk webhook tunnel and the smoke test.

**Deeper docs:**

- [.github/CONTRIBUTING.md](./.github/CONTRIBUTING.md) — local setup,
  env config, 1Password integration, the Clerk webhook tunnel, API
  testing, end-to-end smoke test.
- [.github/MAINTAINING.md](./.github/MAINTAINING.md) — environments,
  GitHub, Vercel, Neon, Clerk, DNS, CI, deploy strategy.
- [packages/cli/README.md](./packages/cli/README.md) — the `rando`
  CLI surface (`init`, `doctor`, `issues`, `db`, `deploy`, `dev`,
  `infrastructure`, `tunnel`, `dns`, `clerk`).
- [CLAUDE.md](./CLAUDE.md) — conventions and patterns we work by.
- [.github/SECURITY.md](./.github/SECURITY.md) — reporting vulnerabilities.
- [.github/CODE_OF_CONDUCT.md](./.github/CODE_OF_CONDUCT.md) — community guidelines.
- [LICENSE](./LICENSE) — PolyForm Noncommercial 1.0.0.

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
- **API contract (ts-rest).** Every route + client + OpenAPI spec is generated from one contract at [`packages/api-client/src/contract.ts`](./packages/api-client/src/contract.ts). Editing a route means editing the contract — the handler, the typed client, and `/v1/openapi.json` all update together (and CI fails if they drift). Only exception: `POST /v1/webhooks/clerk` stays a raw Next handler because Svix signature verification needs raw-body access that doesn't fit the typed model cleanly.

## Endpoints

The full spec is auto-generated at `/v1/openapi.json` (zero drift — see [`packages/api-client/README.md`](./packages/api-client/README.md)). Quick reference:

| Method   | Path                               | Auth        | Notes                                                |
| -------- | ---------------------------------- | ----------- | ---------------------------------------------------- |
| `GET`    | `/v1/health`                       | public      | service identity + timestamp                         |
| `GET`    | `/v1/openapi.json`                 | public      | auto-generated 3.x spec                              |
| `GET`    | `/v1/contacts`                     | Clerk       | filter via `?near=lat,lng &favorites &list &q &sort` |
| `POST`   | `/v1/contacts`                     | Clerk       | compound: location + contact + interaction in one tx |
| `GET`    | `/v1/contacts/:id`                 | Clerk       | optional `?near=lat,lng` for distance                |
| `PATCH`  | `/v1/contacts/:id`                 | Clerk       | strict zod — unknown fields rejected                 |
| `GET`    | `/v1/lists`                        | Clerk       | with memberCount                                     |
| `POST`   | `/v1/lists`                        | Clerk       | custom lists only                                    |
| `GET`    | `/v1/lists/:id`                    | Clerk       | with embedded ContactListItem[]                      |
| `PATCH`  | `/v1/lists/:id`                    | Clerk       | rename only                                          |
| `DELETE` | `/v1/lists/:id`                    | Clerk       | cascades to list_members                             |
| `POST`   | `/v1/lists/:id/members`            | Clerk       | idempotent — returns `{ added: bool }`               |
| `DELETE` | `/v1/lists/:id/members/:contactId` | Clerk       |                                                      |
| `POST`   | `/v1/webhooks/clerk`               | Svix-signed | upserts users from Clerk events                      |

## What's wired but not connected

- **PowerSync**: package stub only. Service + client setup is TODO ([#27](https://github.com/rando-id/rando.id/issues/27)).
- **Sentry / PostHog**: event names defined, init not wired into apps yet ([#41](https://github.com/rando-id/rando.id/issues/41)).
- **Postman collection sync**: CLI side is wired — `rando api postman sync` pushes the OpenAPI spec into a Postman workspace for UI exploration. The canonical test loop lives in [`postman/rando-api.postman_collection.json`](./postman/rando-api.postman_collection.json) (collection-as-code) — regenerate via `rando api postman generate`, hand-author `pm.test()` assertions, then run via `pnpm test:api` locally or wait for `.github/workflows/api-tests.yml` to run it against the PR's preview URL on every push.
- **Storybook + Playwright + CI**: not started.

See [specs/apps.md](./specs/apps.md) §5 for the phased feature plan.
