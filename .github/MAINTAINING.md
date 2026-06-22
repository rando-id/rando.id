# Maintaining Rando.id

Operations: how the cloud side is wired, where each environment lives,
and the manual steps required to provision or replace pieces of the
infrastructure. Day-to-day development concerns (local setup, dev
commands) live in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Environments

Three environments, two domains. `rando-id.dev` covers everything
non-production (local + staging via subdomain prefixes); `rando.id`
is production only.

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

- `dev-*` prefix → a developer's local machine via Cloudflare Tunnel
- `staging-*` prefix → shared staging Vercel deploys on `rando-id.dev`
- Subdomains (or apex) on `rando.id` → production Vercel deploys

## Automating setup with the `rando` CLI

The `rando` CLI ([`packages/cli`](../packages/cli/README.md)) wraps
Neon, Cloudflare, Vercel, Clerk, 1Password, GitHub, and Postman so
most of the manual dashboard work below can be scripted. End-to-end
provisioning of an environment is one command:

```bash
pnpm rando infrastructure setup --env staging   # tunnel + db branch + vercel projects + domains + DNS + env-var push
pnpm rando infrastructure setup --env staging --apps api   # scope to a single app
```

Required env vars — **stored in 1Password**, populated into the root
`.env` by `rando secrets sync` (see
[CONTRIBUTING.md → 1Password integration](./CONTRIBUTING.md#1password-integration-required-path)):

| Variable                | Used by                     |
| ----------------------- | --------------------------- |
| `NEON_API_KEY`          | `rando db ...`              |
| `CLOUDFLARE_API_TOKEN`  | `rando tunnel`, `rando dns` |
| `CLOUDFLARE_ACCOUNT_ID` | `rando tunnel`              |
| `VERCEL_TOKEN`          | `rando deploy`              |
| `VERCEL_TEAM_ID`        | `rando deploy` (optional)   |

Manual step → `rando` equivalent:

| Manual step                                     | `rando` command                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| Cloudflare: add tunnel route                    | `rando tunnel route add <tunnel> <host> <service>`                |
| Cloudflare: list tunnel routes                  | `rando tunnel route list <tunnel>`                                |
| Cloudflare: copy tunnel token                   | `rando tunnel token <tunnel>`                                     |
| Cloudflare: add DNS record                      | `rando dns record add <zone> <type> <name> <content>`             |
| Neon: create project                            | `rando db project create <name>`                                  |
| Neon: create staging branch                     | `rando db branch create <project> staging`                        |
| Neon: enable PostGIS                            | `rando db extension-enable <project> <branch> postgis`            |
| Neon: copy connection string                    | `rando db connection-string <project> <branch> --pooled`          |
| Vercel: create project                          | `rando deploy project create <name> --root <path> --repo <repo>`  |
| Vercel: set env var (per scope)                 | `rando deploy env set <project> <key> <value> --scope ...`        |
| Vercel: add domain (per branch)                 | `rando deploy domain add <project> <host> --branch <branch>`      |
| Clerk: create instance webhook + signing secret | `rando clerk webhook setup --env <env>`                           |
| Clerk: create a user                            | `rando clerk users create --env <env> --email ... --password ...` |

The CLI is intentionally vendor-agnostic at the command layer — swapping
Neon for Supabase, Vercel for Railway, etc. means writing a new adapter,
not changing scripts.

## GitHub

### Initial repo setup

1. Create the repo at `github.com/<owner>/rando.id`
2. From this directory:

   ```bash
   git remote add origin git@github.com:<owner>/rando.id.git
   git push -u origin main
   ```

3. Create the `staging` branch (Vercel needs it to exist before wiring the staging domain):

   ```bash
   git checkout -b staging && git push -u origin staging && git checkout main
   ```

### Branch protection

After the first CI run passes:

- **Settings → Branches → Add rule** for `main` and `staging`:
  - Require a pull request before merging
  - Require status checks to pass — pick `Lint`, `Typecheck`, and `Unit tests`
  - Require branches to be up to date before merging

### Repo secrets

Under **Settings → Secrets and variables → Actions**.

| Secret                     | Purpose                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `OP_SERVICE_ACCOUNT_TOKEN` | 1Password service account. Used by every workflow to read secrets. |

Bootstrap of this token is described in
[CONTRIBUTING.md → Bootstrapping `OP_SERVICE_ACCOUNT_TOKEN` for CI](./CONTRIBUTING.md#bootstrapping-op_service_account_token-for-ci).

## Continuous integration

Workflows are split by function. Each runs on every `push` to `main`
and every `pull_request`, with its own concurrency group so a new
push to a branch cancels the previous run.

| Workflow                                                               | What it does                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`workflows/lint.yml`](./workflows/lint.yml)                           | `pnpm lint` across all workspaces.                                                                                                                                                                                                                                                                                                               |
| [`workflows/typecheck.yml`](./workflows/typecheck.yml)                 | `pnpm typecheck` across all workspaces (Turbo-parallelized).                                                                                                                                                                                                                                                                                     |
| [`workflows/unit-tests.yml`](./workflows/unit-tests.yml)               | `pnpm test:coverage` — vitest + Cobertura/LCOV. Uploads coverage as a run artifact and to GitHub Code Quality (public preview; GA July 2026) for per-PR coverage comments. Requires **Settings → Code security → Code quality** enabled at the repo level + the workflow's `code-quality: write` permission; without both, the upload step 403s. |
| [`workflows/integration-tests.yml`](./workflows/integration-tests.yml) | Postman collection + spec lint against the PR's preview URL on every PR, and nightly against staging.                                                                                                                                                                                                                                            |
| [`workflows/deploy.yml`](./workflows/deploy.yml)                       | Spins up the per-PR branch-deploy (`<slug>-<app>.rando-id.dev`) and tears it down on close.                                                                                                                                                                                                                                                      |
| [`workflows/issues.yml`](./workflows/issues.yml)                       | Transitions tickets referenced in commits as the PR moves through its lifecycle.                                                                                                                                                                                                                                                                 |

Repeated patterns live in composite actions under `.github/actions/`,
so each workflow's YAML only describes what's unique to it:

- **`setup`** — checkout + pnpm + Node 22 + frozen-lockfile install. Optional `install-cli: 'true'` runs `pnpm setup:cli` so `rando` resolves from PATH. Used by every workflow.
- **`changes`** — returns per-workspace booleans (`cli`, `db`, `api`, `web`, ...) plus aggregates (`code`, `docs`, `shared`). Per-workspace booleans come from Turbo's `--filter='...[base]'` so the dep graph is sourced from each package's `package.json` (single source of truth — adding a `@rando/*` runtime dep is automatically reflected, no YAML edit). Aggregates come from `dorny/paths-filter` for file-pattern questions Turbo can't easily express. Workflows gate their real work on these so unrelated PRs don't re-run everything.
- **`op-env`** — install the `op` CLI + dump a 1Password Environment's KEY=VALUE pairs into `$GITHUB_ENV`. Takes the service-account token + an environment ID (defaults to staging). Used by `integration-tests`, `deploy`, `issues` (Jira-only).
- **`issue-refs`** — scan the PR's commit range for `Refs: <KEY>` footers via `rando issues refs`. Outputs `keys` (multiline). Used by `deploy` (for the In Review transition + comment) and `issues` (for the In Progress / Done transitions).

When a pattern starts repeating across two or more workflows, the next
step is a new composite action — keeps the dep graph + secrets handling

- ticket discovery in one place each.

**Not currently in CI:**

- `pnpm build` — Vercel runs Next.js builds on deploy. Adding to CI would catch build-only errors earlier but ~doubles runtime.
- Full integration tests — not yet written.
- Native (Expo) builds — handled by EAS.

## Deploy strategy

Right now **Vercel handles all deploys natively** via its GitHub
integration: push to `main`/`staging`, Vercel builds, Vercel deploys.
GitHub Actions only runs lint + typecheck + unit tests + integration tests. App-level env vars
(`DATABASE_URL`, Clerk keys, etc.) live in Vercel's project settings
and are pushed there by `rando infrastructure setup` from 1Password.

It's option 1 of a three-option spectrum:

| Option                     | Who runs deploys                                 | When it makes sense                                                                                        |
| -------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **1. Vercel-native**       | Vercel auto-deploys on push                      | Solo/small team; web is the entire deploy surface; PR previews "for free"; minimal YAML. **← we're here.** |
| **2. Hybrid**              | Vercel deploys web; Actions does everything else | DB migrations, EAS builds, post-deploy smoke tests, or release uploads (Sentry) around the deploy.         |
| **3. Fully GitHub-driven** | Actions calls `vercel deploy --prebuilt` etc.    | Strict approval gates, audit logs, or compliance — single source of truth for all deploy logic.            |

**Migrate to hybrid (option 2) when any of these become true:**

- **DB migrations need to run before a deploy.** Add a workflow that runs `pnpm --filter @rando/db db:migrate` against `staging` on push to `staging`, and against `main` on a release tag. Each env's `DATABASE_URL` becomes a GitHub Environment secret.
- **EAS submissions need automating.** `eas build && eas submit` for TestFlight / Play Internal Testing belongs in a workflow gated by a release tag.
- **Approval gates.** Prod deploys require a reviewer to click "Deploy" before the workflow continues — GitHub Environments support this via Required reviewers.
- **Release tracking.** Uploading source maps and creating a Sentry release on each prod deploy is most reliably done from CI right after Vercel finishes.

**Migrate to fully GitHub-driven (option 3)** only if you outgrow
Vercel's GitHub integration (rare; usually org-policy-driven).

Switching later is mostly an env-var move (from Vercel Project Settings
into GitHub Environments) plus adding workflow YAML — the app code
itself doesn't change.

### Skipping deploys when no code changed

Two seams filter out PRs / pushes that don't change deployable code:

- **PR preview deploys** — `.github/workflows/deploy.yml`'s
  `branch-deploy` job runs `.github/actions/changes` first and gates
  the substantive deploy steps on
  `outputs.code == 'true' || outputs.shared == 'true'`. `code` covers
  TS/JS source + tsconfig + lockfile; `shared` covers
  `turbo.json` + root `package.json`. Together they catch every
  deploy-worthy change pattern this repo has today. A PR with
  **only** docs / `.notes/**` / `LICENSE` skips with a notice.
  **The teardown job stays unconditional** so closing a PR always
  tears down its Vercel custom domains + Cloudflare CNAMEs — even if
  the final diff ended up docs-only.
- **Prod / staging push deploys** — each app's `vercel.json` sets
  `ignoreCommand: "npx -y turbo-ignore@<version> @rando/<app>"`. Turbo
  walks the workspace dep graph and exits **0** when nothing the app
  transitively depends on changed; Vercel's `ignoreCommand` contract
  is **exit 0 = skip**, exit 1 = proceed. A change inside
  `packages/ui` still triggers `web` + `admin` (both depend on it);
  a change inside `.notes/**` triggers none of them.

  The `turbo-ignore` version is **pinned to match the installed
  `turbo` version** in `pnpm-lock.yaml` so the dep-graph schema
  stays in sync. When you bump `turbo`, bump all three
  `apps/*/vercel.json` files in the same PR. Pinning also limits
  the supply-chain surface — `npx` runs before Vercel installs
  `node_modules` (that's the whole point), so we can't use
  `pnpm exec`. See `.notes/ci-deploy-skip.spec.md` → "Bump policy
  for `turbo-ignore`".

**Don't gate on `outputs.docs`.** `dorny/paths-filter` outputs that
true when **any** changed file matches the docs pattern, not when
**every** file is docs. A PR with a `.ts` change AND a `README.md`
update has both `docs=true` and `code=true` — a `docs != 'true'` gate
would incorrectly skip it. Always use the positive `code || shared`
signal.

**Don't use `paths-ignore` at the workflow `on:` level for deploy.yml.**
It applies to every `pull_request` event type, so a PR amended to
remove all deploy-worthy changes before close would skip the workflow
entirely and orphan infra. The job-level gate above keeps teardown
safe.

To widen the deploy-worthy signal, edit the `code:` or `shared:`
patterns in `.github/actions/changes/action.yml` (shared with
`lint.yml`, `typecheck.yml`, `codeql.yml`). Adjust `turbo.json`'s
`inputs` if you need to exclude per-workspace docs from the cache key.

## Cloudflare

### DNS zones

Two zones, both on Cloudflare:

- **`rando-id.dev`** — non-production traffic (local dev tunnel + staging Vercel)
- **`rando.id`** — production only

### Tunnel public hostnames (local dev)

The Cloudflare Tunnel (defined in
[`docker-compose.yml`](../docker-compose.yml)) exposes local apps at
stable URLs so webhook providers can reach a developer's machine.

In **Zero Trust dashboard → Networks → Published Application Routes**:

| Subdomain   | Domain         | Type | URL                         | Access policy | Routes to          |
| ----------- | -------------- | ---- | --------------------------- | ------------- | ------------------ |
| `dev-web`   | `rando-id.dev` | HTTP | `host.docker.internal:3000` | Bypass        | local `apps/web`   |
| `dev-admin` | `rando-id.dev` | HTTP | `host.docker.internal:3100` | Bypass        | local `apps/admin` |
| `dev-api`   | `rando-id.dev` | HTTP | `host.docker.internal:4000` | Bypass        | local `apps/api`   |

Application type: **Self-hosted**. `dev-api` must be **Bypass** so
Clerk webhooks can reach it.

### DNS for Vercel deployments

| Zone           | Record | Name            | Target           | Purpose         |
| -------------- | ------ | --------------- | ---------------- | --------------- |
| `rando-id.dev` | CNAME  | `staging-web`   | _(Vercel-given)_ | staging web     |
| `rando-id.dev` | CNAME  | `staging-admin` | _(Vercel-given)_ | staging admin   |
| `rando-id.dev` | CNAME  | `staging-api`   | _(Vercel-given)_ | staging API     |
| `rando.id`     | CNAME  | `@` (apex)      | _(Vercel-given)_ | prod web (apex) |
| `rando.id`     | CNAME  | `admin`         | _(Vercel-given)_ | prod admin      |
| `rando.id`     | CNAME  | `api`           | _(Vercel-given)_ | prod API        |

Cloudflare's CNAME flattening handles apex `@` CNAMEs automatically.
`rando infrastructure setup` creates these records as part of the
end-to-end flow.

## Neon (Postgres)

One Neon project, two branches. Branches give copy-on-write isolation —
staging can diverge from prod without affecting it.

### Initial setup

`pnpm rando infrastructure setup --env staging` provisions everything
end-to-end. Manual equivalent:

1. neon.tech → **Create project**
   - Project name: `rando`
   - Region: closest to your Vercel region (default: `us-east-2 (AWS)`)
   - Postgres version: 16
2. After creation, the project comes with one branch (`main`). In the **Branches** tab, create a second branch named `staging` (source: `main`).
3. **Enable PostGIS on both branches.** In the SQL Editor on each branch:

   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```

4. Copy each branch's **pooled** connection string from Connection Details — plug into Vercel via 1Password + `rando infrastructure setup`.

### Running migrations

`packages/db` works against any `DATABASE_URL`:

```bash
# Staging:
DATABASE_URL='<neon-staging-pooled>' pnpm --filter @rando/db db:migrate

# Prod:
DATABASE_URL='<neon-main-pooled>' pnpm --filter @rando/db db:migrate
```

Manual today. TODO: automate via CI on `main` push (staging) and on
git tag (prod), gated on approval.

## Vercel

Three projects — one per Next.js app. The native Expo app is **not**
on Vercel (it builds via EAS).

| App   | Vercel project | Production URL   | Staging URL                  |
| ----- | -------------- | ---------------- | ---------------------------- |
| Web   | `rando-web`    | `rando.id`       | `staging-web.rando-id.dev`   |
| Admin | `rando-admin`  | `admin.rando.id` | `staging-admin.rando-id.dev` |
| API   | `rando-api`    | `api.rando.id`   | `staging-api.rando-id.dev`   |

### Creating a project (manual, one-time per app)

`rando infrastructure setup` does this end-to-end. Manual fallback:

1. Vercel dashboard → **Add New → Project** → import the GitHub repo
2. **Root Directory:** `apps/<app-name>`
3. **Framework Preset:** Next.js (auto-detected)
4. **Install / Build / Output Directory:** leave defaults
5. **Production Branch:** `main` (Settings → Git after import)
6. Add env vars (next section) **before** the first deploy
7. **Deploy**

### Wiring staging to the `staging` branch

Production deploys come from `main`. To get staging from `staging` on a stable URL:

1. **Settings → Domains** → add the staging domain (e.g. `staging-web.rando-id.dev`)
2. Click **Edit** on that domain → **Git Branch** field → `staging`
3. Repeat for production: add the prod domain; leave branch as `main`

This way:

- Push to `main` → builds, deploys, updates the prod domain
- Push to `staging` → builds, deploys, updates the staging domain
- Open a PR → unique Vercel preview URL with no custom domain

### Environment variables

In each Vercel project, set vars under **Settings → Environment
Variables**. Use the **Production**, **Preview**, **Development**
scopes intentionally:

- **Production** = deploys from `main`
- **Preview** = all non-prod deploys (PRs + `staging` branch). Vercel's free tier doesn't split staging from preview, so staging values are used for PR previews too.
- **Development** = `vercel dev` locally (we use `next dev` instead, so this scope is unused).

`rando infrastructure setup --env staging` reads each app's
`.env.example` for the key list, fetches values from the 1P `staging`
environment, and pushes them to the `preview` scope. Same for
production with the `production` scope.

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

Vercel automatically detects Turbo + pnpm workspaces. Each project
rebuilds only when files in its root directory or its package
dependencies change — Turbo's `transpilePackages` chain handles this
through `turbo.json`. Build-time env vars are declared under
`turbo.json` → `tasks.build.env` so they survive the cache hash.

## Clerk

Two Clerk instances under one application:

- **Development** — `pk_test_*` / `sk_test_*`. Used by local-via-tunnel, Vercel preview deploys, **and** the staging environment. Has its own user store separate from production.
- **Production** — `pk_live_*` / `sk_live_*`. Used only by production Vercel deploys. Has its own (real) user store.

### Webhook endpoints

Three webhook endpoints across the two Clerk instances:

| Environment | Clerk instance | Endpoint URL                                         | Signing secret stored in                         |
| ----------- | -------------- | ---------------------------------------------------- | ------------------------------------------------ |
| Local       | Development    | `https://dev-api.rando-id.dev/v1/webhooks/clerk`     | `apps/api/.env`                                  |
| Staging     | Development    | `https://staging-api.rando-id.dev/v1/webhooks/clerk` | `rando-api` Vercel project, **Preview** scope    |
| Production  | Production     | `https://api.rando.id/v1/webhooks/clerk`             | `rando-api` Vercel project, **Production** scope |

Each endpoint subscribes to: `user.created`, `user.updated`, `user.deleted`.

After deploying `rando-api` for the first time, create the Staging and
Production webhook endpoints in the respective Clerk instances and
push the signing secrets via:

```bash
pnpm rando clerk webhook setup --env staging   # half-auto: opens Svix dashboard URL, prompts for the signing secret, writes to 1P + Vercel
pnpm rando clerk webhook setup --env prod
```

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

- Feature branches → PRs into `staging` for QA on Vercel preview URLs
- Merge to `staging` → deploys to `staging-*.rando-id.dev`
- When staging is happy → PR from `staging` → `main`. Merging ships to prod.

## Native (EAS)

_TBD — populate when first published._ Key steps will be:

- `eas init` → creates `eas.json` and links the project
- `eas build --profile preview` → internal TestFlight / Play Internal Testing
- `eas submit` → store submission

For native API endpoints: the `EXPO_PUBLIC_RANDO_API_URL` env var in
`apps/native/.env` (and EAS build profiles) determines which
environment the app hits:

| Build profile        | `EXPO_PUBLIC_RANDO_API_URL`        |
| -------------------- | ---------------------------------- |
| sim / dev            | `https://dev-api.rando-id.dev`     |
| staging / TestFlight | `https://staging-api.rando-id.dev` |
| App Store / Play     | `https://api.rando.id`             |

## Pre-commit hooks (local mirror of CI)

Local commits run [`lint-staged`](https://github.com/lint-staged/lint-staged)
via a [`husky`](https://typicode.github.io/husky/) pre-commit hook so
the same checks CI runs are enforced before code leaves your machine.

| Trigger                                | What runs                                                 |
| -------------------------------------- | --------------------------------------------------------- |
| Any staged `*.{ts,tsx,js,jsx,mjs,cjs}` | `eslint --fix --no-warn-ignored`, then `prettier --write` |
| Any staged `*.{json,md,yml,yaml,css}`  | `prettier --write`                                        |

Config lives in the root `package.json` under `lint-staged`. The hook
itself is at `.husky/pre-commit`. Auto-installed by `pnpm install`.
