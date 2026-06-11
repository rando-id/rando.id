# Infrastructure

How Rando.id's hosting, deployment, and CI work across environments.
Local-only dev concerns (Docker, basic env files) live in
[DEVELOPER_SETUP.md](./DEVELOPER_SETUP.md); this doc covers the cloud side.

## Environments

Three environments, two domains. `rando-id.dev` covers everything
non-production (local + staging via subdomain prefixes); `rando.id` is
production only.

|              | Local (your laptop)           | Staging                      | Production                |
| ------------ | ----------------------------- | ---------------------------- | ------------------------- |
| Purpose      | Day-to-day dev                | Internal QA / demos          | Public users              |
| Web          | `dev-web.rando-id.dev`        | `staging-web.rando-id.dev`   | `rando.id`                |
| Admin        | `dev-admin.rando-id.dev`      | `staging-admin.rando-id.dev` | `admin.rando.id`          |
| API          | `dev-api.rando-id.dev`        | `staging-api.rando-id.dev`   | `api.rando.id`            |
| Postgres     | Docker (PostGIS image)        | Neon `staging` branch        | Neon `main` branch        |
| Clerk        | Dev instance (test keys)      | Dev instance (test keys)     | Prod instance (live keys) |
| Hosting      | localhost + Cloudflare Tunnel | Vercel                       | Vercel                    |
| Deploys from | n/a (your machine)            | `staging` branch             | `main` branch             |

**Naming conventions:**

- `dev-*` prefix → a developer's local machine via Cloudflare Tunnel.
- `staging-*` prefix → shared staging Vercel deploys on `rando-id.dev`.
- Subdomains (or apex) on `rando.id` → production Vercel deploys.

The apex `rando-id.dev` itself isn't used by any app — leave it as a default
Cloudflare page, redirect it to `staging-web.rando-id.dev`, or use it for an
internal landing page later.

## GitHub

### Initial repo setup

1. Create a private repo at `github.com/<owner>/rando`.
2. From this directory:
   ```bash
   git remote add origin git@github.com:<owner>/rando.git
   git push -u origin main
   ```
3. Create the `staging` branch (Vercel needs it to exist before you wire the
   staging domain):
   ```bash
   git checkout -b staging && git push -u origin staging && git checkout main
   ```

### Branch protection (recommended)

After the first CI run passes:

- **Settings → Branches → Add rule** for `main` and `staging`:
  - Require a pull request before merging
  - Require status checks to pass — pick `typecheck + lint`
  - Require branches to be up to date before merging

### Secrets

Stored under **Settings → Secrets and variables → Actions**.

| Secret       | Purpose                                                 |
| ------------ | ------------------------------------------------------- |
| _(none yet)_ | CI currently only typechecks/lints — no secrets needed. |

Add secrets here when CI starts running migrations, deploying, or hitting
external services.

## Continuous integration

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs on every push to
`main` and every pull request. It currently:

- Installs deps with `pnpm install --frozen-lockfile`
- Runs `pnpm typecheck` across all workspaces (Turbo-parallelized)
- Runs `pnpm lint` across all workspaces

Concurrency is set so a new push to a branch cancels the previous run on that
same ref — saves Actions minutes on rapid iteration.

**Not currently in CI** (deferred until we have something to protect):

- `pnpm build` — Vercel runs Next.js builds on deploy. Adding it to CI would
  catch build-only errors earlier but ~doubles runtime and would need every
  app's env vars set as GH secrets.
- `pnpm test` — no tests written yet.
- Native (Expo) builds — handled by EAS, not CI.

## Pre-commit hooks (local mirror of CI)

Local commits run [`lint-staged`](https://github.com/lint-staged/lint-staged)
via a [`husky`](https://typicode.github.io/husky/) pre-commit hook so the same
checks CI runs are enforced before code leaves your machine.

| Trigger                                | What runs                                                 |
| -------------------------------------- | --------------------------------------------------------- |
| Any staged `*.{ts,tsx,js,jsx,mjs,cjs}` | `eslint --fix --no-warn-ignored`, then `prettier --write` |
| Any staged `*.{json,md,yml,yaml,css}`  | `prettier --write`                                        |

Configuration lives in the root `package.json` under `lint-staged`. The hook
itself is at `.husky/pre-commit`. ESLint resolves to the root
[`eslint.config.js`](./eslint.config.js), which routes per-file-glob to the
shared `next` or `react-native` config.

**Auto-install for new developers.** The root `package.json` has a `prepare`
script that runs `husky` on `pnpm install`, so anyone who clones the repo
gets the hook wired up automatically — no manual setup.

**Verifying it works:**

```bash
echo "const x:string='foo';let y = x" > test-lint.ts
git add test-lint.ts && git commit -m "test"
# prettier rewrites + eslint fixes — or blocks if unfixable
git restore --staged test-lint.ts && rm test-lint.ts
```

**Bypassing (rare).** `git commit --no-verify` skips the hook. Use only on
intentionally-broken WIP branches — never on `main` or `staging`.

## Cloudflare

### DNS zones

Two zones, both on Cloudflare:

- **`rando-id.dev`** — handles all non-production traffic (local dev tunnel +
  staging Vercel deploys).
- **`rando.id`** — production only.

### Tunnel public hostnames (local dev)

The Cloudflare Tunnel (defined in [`docker-compose.yml`](./docker-compose.yml))
exposes your local apps at stable URLs so you can stop typing `localhost` and
so webhook providers can reach your machine.

In **Zero Trust dashboard → Networks → Tunnels → `rando-dev` → Public
Hostnames**, configure three entries:

| Subdomain   | Domain         | Type | URL                         | Routes to          |
| ----------- | -------------- | ---- | --------------------------- | ------------------ |
| `dev-web`   | `rando-id.dev` | HTTP | `host.docker.internal:3000` | local `apps/web`   |
| `dev-admin` | `rando-id.dev` | HTTP | `host.docker.internal:3100` | local `apps/admin` |
| `dev-api`   | `rando-id.dev` | HTTP | `host.docker.internal:4000` | local `apps/api`   |

> If you have the legacy `api.rando-id.dev` route still pointing at
> `host.docker.internal:4000`, **remove it** — that namespace is now reserved
> for Vercel staging under the `staging-*` prefix.

Cloudflare auto-creates the matching DNS records (CNAMEs to your tunnel).

### DNS for Vercel deployments

Once each Vercel project is created, Vercel gives you target hostnames (e.g.
`cname.vercel-dns.com`) to point your DNS at. In Cloudflare:

| Zone           | Record | Name            | Target           | Purpose         |
| -------------- | ------ | --------------- | ---------------- | --------------- |
| `rando-id.dev` | CNAME  | `staging-web`   | _(Vercel-given)_ | staging web     |
| `rando-id.dev` | CNAME  | `staging-admin` | _(Vercel-given)_ | staging admin   |
| `rando-id.dev` | CNAME  | `staging-api`   | _(Vercel-given)_ | staging API     |
| `rando.id`     | CNAME  | `@` (apex)      | _(Vercel-given)_ | prod web (apex) |
| `rando.id`     | CNAME  | `admin`         | _(Vercel-given)_ | prod admin      |
| `rando.id`     | CNAME  | `api`           | _(Vercel-given)_ | prod API        |

Cloudflare's CNAME flattening handles apex (`@`) CNAMEs automatically.

## Neon (Postgres)

One Neon project, two branches. Branches give you copy-on-write isolation —
staging can diverge from prod without affecting it.

### Initial setup

1. neon.tech → **Create project**
   - Project name: `rando`
   - Region: closest to your Vercel region (default: `us-east-2 (AWS)`)
   - Postgres version: 16
2. After creation, the project comes with one branch named `main`. In the
   **Branches** tab, create a second branch named `staging` (source: `main`).
3. **Enable PostGIS on both branches.** In the **SQL Editor**, switch to each
   branch and run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```
4. From **Connection Details**, copy each branch's **pooled** connection
   string (toggle "Pooled connection" on). You'll plug these into Vercel.

### Running migrations

`packages/db` works against any `DATABASE_URL`. From your local machine:

```bash
# Apply migrations to staging
DATABASE_URL='<neon-staging-pooled>' pnpm --filter @rando/db db:migrate

# Apply migrations to prod
DATABASE_URL='<neon-main-pooled>' pnpm --filter @rando/db db:migrate
```

This is manual today. TODO: automate via CI on `main` push (for staging) and
on git tag (for prod), gated on approval.

## Vercel

Three projects total — one per Next.js app. The native Expo app is **not**
on Vercel (it builds via EAS).

| App   | Vercel project | Production URL   | Staging URL                  |
| ----- | -------------- | ---------------- | ---------------------------- |
| Web   | `rando-web`    | `rando.id`       | `staging-web.rando-id.dev`   |
| Admin | `rando-admin`  | `admin.rando.id` | `staging-admin.rando-id.dev` |
| API   | `rando-api`    | `api.rando.id`   | `staging-api.rando-id.dev`   |

### Creating a project (one-time, per app)

1. Vercel dashboard → **Add New → Project** → import the GitHub repo
2. **Root Directory**: `apps/<app-name>`
3. **Framework Preset**: Next.js (auto-detected)
4. **Install Command**: leave default — Vercel auto-detects pnpm from
   `packageManager` in root `package.json`
5. **Build Command**: leave default (`next build`)
6. **Output Directory**: leave default (`.next`)
7. **Production Branch**: `main` (Settings → Git after the import wizard)
8. Add environment variables (next section) **before** the first deploy
9. Click **Deploy**

### Wiring staging to the `staging` branch

Production deploys come from `main`. To get staging from the `staging` branch
on a stable URL:

1. **Settings → Domains** → add the staging domain
   (e.g. `staging-web.rando-id.dev` for `rando-web`)
2. Click **Edit** on that domain → **Git Branch** field → enter `staging`
3. Repeat for production: add the prod domain (e.g. `rando.id` for
   `rando-web`); leave the branch as `main` (default)

This way:

- Push to `main` → builds, deploys, and updates the prod domain
- Push to `staging` → builds, deploys, and updates the staging domain
- Open a PR → still gets a unique Vercel preview URL with no custom domain

### Environment variables

In each Vercel project, set vars under **Settings → Environment Variables**.
Use the **Production**, **Preview**, **Development** scopes intentionally:

- **Production** = used by deploys from `main`
- **Preview** = used by all non-prod deploys (PRs + `staging` branch).
  Vercel doesn't natively split "staging" out from "preview" on the free
  tier, so we use Preview-scoped vars for both. Staging values for shared
  resources (DB, Clerk) are fine for PR previews too.
- **Development** = used only when running `vercel dev` locally (we use
  `next dev` instead, so this scope is unused).

#### `rando-api`

| Variable                            | Production                                | Preview (staging + PRs)                                               |
| ----------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`                      | Neon `main` pooled URL                    | Neon `staging` pooled URL                                             |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk **prod** instance (`pk_live_*`)     | Clerk **dev** instance (`pk_test_*`)                                  |
| `CLERK_SECRET_KEY`                  | Clerk **prod** instance (`sk_live_*`)     | Clerk **dev** instance (`sk_test_*`)                                  |
| `CLERK_WEBHOOK_SECRET`              | Clerk **prod** webhook signing secret     | Clerk **dev** webhook signing secret (staging endpoint)               |
| `CORS_ALLOWED_ORIGINS`              | `https://rando.id,https://admin.rando.id` | `https://staging-web.rando-id.dev,https://staging-admin.rando-id.dev` |
| `SENTRY_DSN`                        | Sentry prod DSN (when wired)              | Sentry dev DSN (when wired)                                           |

#### `rando-web`

| Variable                            | Production                    | Preview (staging + PRs)            |
| ----------------------------------- | ----------------------------- | ---------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk **prod** instance       | Clerk **dev** instance             |
| `CLERK_SECRET_KEY`                  | Clerk **prod** instance       | Clerk **dev** instance             |
| `NEXT_PUBLIC_RANDO_API_URL`         | `https://api.rando.id`        | `https://staging-api.rando-id.dev` |
| `NEXT_PUBLIC_POSTHOG_KEY`           | PostHog prod key (when wired) | PostHog dev key (when wired)       |
| `NEXT_PUBLIC_SENTRY_DSN`            | Sentry prod DSN (when wired)  | Sentry dev DSN (when wired)        |

#### `rando-admin`

| Variable                            | Production                  | Preview (staging + PRs)                          |
| ----------------------------------- | --------------------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk **prod** instance     | Clerk **dev** instance                           |
| `CLERK_SECRET_KEY`                  | Clerk **prod** instance     | Clerk **dev** instance                           |
| `ADMIN_ALLOWED_EMAILS`              | comma-separated prod admins | comma-separated staging admins (e.g. your email) |

### Monorepo & Turbo on Vercel

Vercel automatically detects Turbo + pnpm workspaces. By default each project
only rebuilds when files in its root directory or its package dependencies
change — Turbo's `transpilePackages` chain handles this through
`turbo.json`. No manual `ignoreCommand` needed.

## Clerk

Two Clerk instances under one Clerk application:

- **Development** — generated `pk_test_*` keys. Used by local-via-tunnel,
  Vercel preview deploys, **and** the staging environment. Has its own
  user store separate from production.
- **Production** — `pk_live_*` keys. Used only by production Vercel deploys.
  Has its own (real) user store.

### Webhook endpoints

Three webhook endpoints across the two Clerk instances:

| Environment | Clerk instance | Endpoint URL                                         | Signing secret stored in                         |
| ----------- | -------------- | ---------------------------------------------------- | ------------------------------------------------ |
| Local       | Development    | `https://dev-api.rando-id.dev/v1/webhooks/clerk`     | `apps/api/.env.local`                            |
| Staging     | Development    | `https://staging-api.rando-id.dev/v1/webhooks/clerk` | `rando-api` Vercel project, **Preview** scope    |
| Production  | Production     | `https://api.rando.id/v1/webhooks/clerk`             | `rando-api` Vercel project, **Production** scope |

Each endpoint subscribes to: `user.created`, `user.updated`, `user.deleted`.

After deploying `rando-api` for the first time, create the Staging and
Production webhook endpoints in the respective Clerk instances and paste the
signing secrets into Vercel under the right scope.

## Branching workflow

```
main      ── prod deploys (Vercel) ── rando.id
  ▲
  │ PR
  │
staging   ── staging deploys (Vercel) ── staging-*.rando-id.dev
  ▲
  │ PR
  │
<feature> ── PR preview deploys (Vercel) ── *.vercel.app
```

- Feature branches open PRs into `staging` for QA on Vercel preview URLs.
- Merging into `staging` deploys to the `staging-*.rando-id.dev` subdomains.
- When staging is happy, open a PR from `staging` → `main`. Merging that
  ships to prod (`rando.id`).

## Native (EAS)

_TBD — populate when first published._ Key steps will be:

- `eas init` → creates `eas.json` and links the project
- `eas build --profile preview` → internal TestFlight / Play Internal Testing
- `eas submit` → store submission

For native API endpoints: the `EXPO_PUBLIC_RANDO_API_URL` env var in
`apps/native/.env.local` (and EAS build profiles) determines which environment
the app hits.

| Build profile        | `EXPO_PUBLIC_RANDO_API_URL`        |
| -------------------- | ---------------------------------- |
| sim / dev            | `https://dev-api.rando-id.dev`     |
| staging / TestFlight | `https://staging-api.rando-id.dev` |
| App Store / Play     | `https://api.rando.id`             |
