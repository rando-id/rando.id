# Infrastructure

How Rando.id's hosting, deployment, and continuous integration are wired up.
Local-dev concerns (Postgres, Cloudflare Tunnel for webhooks) live in
[DEVELOPER_SETUP.md](./DEVELOPER_SETUP.md); this doc is about the cloud side.

## Overview

| Component          | Host                   | URL                                      |
| ------------------ | ---------------------- | ---------------------------------------- |
| Web                | Vercel                 | `rando-id.dev`                           |
| Admin              | Vercel                 | `admin.rando-id.dev`                     |
| API                | Vercel                 | `api.rando-id.dev` _(prod)_              |
| Native iOS/Android | EAS → App Store / Play | TBD                                      |
| Postgres           | Neon (planned)         | TBD                                      |
| Auth               | Clerk                  | `magnetic-manatee-33.clerk.accounts.dev` |
| DNS                | Cloudflare             | `rando-id.dev`                           |
| Repo + CI          | GitHub Actions         | `github.com/<owner>/rando`               |

> **Dev vs prod hostnames.** The dev Cloudflare Tunnel currently routes
> `api.rando-id.dev` to `host.docker.internal:4000` (see
> [DEVELOPER_SETUP.md](./DEVELOPER_SETUP.md#cloudflare-tunnel--clerk-webhooks)).
> Once the API is deployed to Vercel, you'll need to choose:
> (a) move the dev tunnel to `dev-api.rando-id.dev` and let prod take
> `api.rando-id.dev`, or (b) use a separate dev-only domain entirely.

## GitHub

### Initial repo setup

1. Create a private repo at `github.com/<owner>/rando`.
2. From this directory:
   ```bash
   git remote add origin git@github.com:<owner>/rando.git
   git push -u origin main
   ```

### Branch protection (recommended)

After the first CI run passes:

- **Settings → Branches → Add rule** for `main`:
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
itself is at `.husky/pre-commit`.

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

**Why `--no-warn-ignored`?** Without it, staging an ESLint-ignored file (e.g.,
`next-env.d.ts`) would fail the commit. The flag tells ESLint to silently skip
ignored files instead.

**Bypassing (rare).** `git commit --no-verify` skips the hook. Use only when
you're committing intentionally broken state (e.g., a WIP branch) — and never
on `main`.

## Vercel

Each Next.js app is its own Vercel project. The Expo native app is **not** on
Vercel — it's built via EAS.

### Project structure

| App   | Vercel project name | Repo root directory | Production URL       |
| ----- | ------------------- | ------------------- | -------------------- |
| Web   | `rando-web`         | `apps/web`          | `rando-id.dev`       |
| Admin | `rando-admin`       | `apps/admin`        | `admin.rando-id.dev` |
| API   | `rando-api`         | `apps/api`          | `api.rando-id.dev`   |

### Creating a Vercel project (one-time, per app)

1. Vercel dashboard → **Add New → Project** → import the GitHub repo
2. **Root Directory**: `apps/<app-name>` (e.g. `apps/web`)
3. **Framework Preset**: Next.js (auto-detected)
4. **Install Command**: leave default — Vercel auto-detects pnpm via
   `packageManager` in root `package.json`
5. **Build Command**: leave default (`next build`)
6. **Output Directory**: leave default (`.next`)
7. Add environment variables (next section) **before** the first deploy
8. Click **Deploy**
9. Once deployed, **Settings → Domains** → add the production URL from the
   table above. DNS is on Cloudflare, so add a CNAME there pointing to the
   Vercel-provided `cname.vercel-dns.com`.

### Environment variables

Set per-project under **Settings → Environment Variables**. Use the
**Production**, **Preview**, **Development** scopes intentionally — preview
deploys (from PRs) should typically hit the **dev** Clerk instance and **dev**
DB so you can't accidentally tamper with prod data from a PR.

#### `rando-api`

| Variable                            | Source                                            |
| ----------------------------------- | ------------------------------------------------- |
| `DATABASE_URL`                      | Neon Postgres (prod) — keep dev/prod separate     |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk **production** instance                     |
| `CLERK_SECRET_KEY`                  | Clerk **production** instance                     |
| `CLERK_WEBHOOK_SECRET`              | Clerk **production** webhook signing secret       |
| `CORS_ALLOWED_ORIGINS`              | `https://rando-id.dev,https://admin.rando-id.dev` |
| `SENTRY_DSN`                        | Sentry project DSN (optional until wired)         |

#### `rando-web`

| Variable                            | Source                         |
| ----------------------------------- | ------------------------------ |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk **production** instance  |
| `CLERK_SECRET_KEY`                  | Clerk **production** instance  |
| `NEXT_PUBLIC_RANDO_API_URL`         | `https://api.rando-id.dev`     |
| `NEXT_PUBLIC_POSTHOG_KEY`           | PostHog project key (optional) |
| `NEXT_PUBLIC_SENTRY_DSN`            | Sentry project DSN (optional)  |

#### `rando-admin`

| Variable                            | Source                        |
| ----------------------------------- | ----------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk **production** instance |
| `CLERK_SECRET_KEY`                  | Clerk **production** instance |
| `ADMIN_ALLOWED_EMAILS`              | Comma-separated allowlist     |

### Monorepo & Turbo on Vercel

Vercel automatically detects Turbo + pnpm workspaces. By default each project
only rebuilds when files in its root directory or its package dependencies
change — Turbo's `transpilePackages` chain handles this through
`turbo.json`. No manual `ignoreCommand` needed.

## Production Clerk webhook

After `rando-api` is live on Vercel:

1. Clerk dashboard → **Webhooks → Add Endpoint**
   - URL: `https://api.rando-id.dev/v1/webhooks/clerk`
   - Subscribe: `user.created`, `user.updated`, `user.deleted`
2. Copy the **Signing Secret** → set as `CLERK_WEBHOOK_SECRET` on the
   `rando-api` Vercel project (Production scope), then redeploy.

The dev webhook (going through Cloudflare Tunnel to localhost) stays
separate — it has its own signing secret and points at the dev Clerk
instance. See [DEVELOPER_SETUP.md](./DEVELOPER_SETUP.md#3-wire-the-clerk-webhook).

## Database (Neon)

_TBD — populate when the API is first deployed. Likely setup:_

- One Neon project, two branches: `main` (prod) and `dev` (Vercel preview deploys)
- Connection pooling via Neon's pooled connection string in `DATABASE_URL`
- Schema lives in `packages/db/src/schema.ts`; migrations applied via
  `pnpm --filter @rando/db db:migrate` against the target `DATABASE_URL`

## Native (EAS)

_TBD — populate when first published._ Key steps will be:

- `eas init` → creates `eas.json` and links the project
- `eas build --profile preview` → internal TestFlight / Play Internal Testing
- `eas submit` → store submission
