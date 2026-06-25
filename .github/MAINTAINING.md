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

| Variable                          | Used by                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEON_API_KEY`                    | `rando db ...`                                                                                                                                                  |
| `CLOUDFLARE_API_TOKEN`            | `rando tunnel`, `rando dns`                                                                                                                                     |
| `CLOUDFLARE_ACCOUNT_ID`           | `rando tunnel`                                                                                                                                                  |
| `VERCEL_TOKEN`                    | `rando deploy`                                                                                                                                                  |
| `VERCEL_TEAM_ID`                  | `rando deploy` (optional)                                                                                                                                       |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | `integration-tests.yml` — bypass Deployment Protection on preview URLs (staging env only). See `.notes/ci-vercel-protection-bypass.spec.md` for one-time setup. |

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

- **Settings → Branches → Add rule** for `main` ONLY:
  - Require a pull request before merging
  - Require status checks to pass — pick `Lint`, `Typecheck`, and `Unit tests`
  - Require branches to be up to date before merging

**Do NOT add a protection rule for `staging`.** The `sync-staging.yml` workflow needs to push directly to `staging` via the default `GITHUB_TOKEN`, and PR-required rules block that path (`GITHUB_TOKEN` cannot satisfy "require a pull request before merging" — it can't open a PR to itself). Staging is a deploy trigger, NOT a review boundary. If it ever needs protection (e.g. to lock down direct human pushes), the rule must explicitly bypass for `github-actions[bot]` or use a deploy key with the protection-bypass list — but until then, leave `staging` unprotected. See [`.notes/ci-staging-auto-sync.spec.md`](../.notes/ci-staging-auto-sync.spec.md) for the design rationale.

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
| [`workflows/integration-tests.yml`](./workflows/integration-tests.yml) | Postman collection + spec lint against a deployed API. Smart-targets the PR's preview when one is expected (PR carries `deploy-preview` label), falls back to staging for unlabeled PRs and on preview-fetch timeout. Nightly cron always runs against staging. See `.notes/ci-integration-tests-smart-target.spec.md`.                          |
| [`workflows/deploy-preview.yml`](./workflows/deploy-preview.yml)       | Per-PR branch deploy (`<slug>-<app>.rando-id.dev`) when the PR carries the `deploy-preview` label; tears down on close.                                                                                                                                                                                                                          |
| [`workflows/deploy-staging.yml`](./workflows/deploy-staging.yml)       | Auto-deploys to the Vercel staging environment on every push to the `staging` branch. Also `workflow_dispatch` for manual redeploys / rollbacks.                                                                                                                                                                                                 |
| [`workflows/deploy-production.yml`](./workflows/deploy-production.yml) | Manual prod deploy via `workflow_dispatch` only — gated by the `production` GitHub Environment's required reviewer.                                                                                                                                                                                                                              |
| [`workflows/sync-staging.yml`](./workflows/sync-staging.yml)           | Fast-forwards the `staging` branch from `main` on every push to main, so `deploy-staging.yml` can fire on the synced tip.                                                                                                                                                                                                                        |
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

Every Vercel deploy at Rando — preview, staging, production — runs
through one of our `deploy-*.yml` workflows via `rando deploy …`.
Vercel's native git integration is **off** (set by `rando infra
setup` — D1 of [`.notes/process-deploy-strategy.spec.md`](../.notes/process-deploy-strategy.spec.md)),
so no push ever auto-deploys behind our back. Single source of truth,
gated explicitly per environment.

### The four modes

| Trigger                             | Workflow                | Gate                                                                                                                             | Vercel target        |
| ----------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| PR sync with `deploy-preview` label | `deploy-preview.yml`    | `deploy-preview` label on the PR + per-app affected gate ([per-app-preview-gating](../.notes/ci-per-app-preview-gating.spec.md)) | preview (per-branch) |
| Push to `staging`                   | `deploy-staging.yml`    | `vars.DEPLOY_STAGING_ENABLED != 'false'`                                                                                         | staging              |
| Manual `workflow_dispatch`          | `deploy-production.yml` | GitHub Environment `production` reviewer approval + `vars.DEPLOY_PRODUCTION_ENABLED != 'false'`                                  | production           |
| Any other push                      | _(nothing)_             | —                                                                                                                                | —                    |

`sync-staging.yml` keeps the `staging` branch fast-forwarded from
`main` on every push to main, so the practical effect is: merge to
main → staging fast-forwards → `deploy-staging.yml` fires → staging
Vercel environment updated.

### Production deploy SOP

Production is the only manual mode. Steps the operator follows:

1. **Verify staging is healthy** on the same SHA you want to ship.
   The integration-test rollup against staging is the lightest check;
   for higher confidence, exercise the staging URLs manually.
2. **Actions → Deploy production → Run workflow.** Enter the commit
   SHA in the `ref` input. Defaults to the workflow's branch (main).
3. **Wait for Environment approval.** The job pauses at the
   `production` Environment gate until a reviewer (per Settings →
   Environments → production → Required reviewers) clicks approve.
4. **Watch the deploy step.** `rando deploy promote production --ref
<sha>` polls each app's deployment until ready or errored.
   Partial-failure exits non-zero so the workflow goes red; rerun
   after fixing.
5. **Rollback** = re-dispatch with the previous known-good SHA.

### Initial Vercel setup

`rando infra setup` is the one-shot:

- Creates Vercel projects (idempotent — skips existing ones)
- Pushes 1Password env vars to each project's `preview` / `production`
  scopes
- Adds custom domains per env (`staging-<app>.rando-id.dev`,
  `<app>.rando.id`)
- Adds matching Cloudflare CNAMEs
- **Disables Vercel's native git integration** —
  `previewDeploymentsDisabled: true` + `gitProviderOptions.createDeployments:
"disabled"` via PATCH; combined with `apps/<name>/vercel.json`'s
  `git.deploymentEnabled: { main: false, staging: false }` block in
  the repo, this fully suppresses push-triggered deploys.

Re-running is a no-op when state matches target.

### Adding a new app

Four file edits + one orchestrator run, no Vercel dashboard work:

1. Add the workspace to `rando.config.json`'s `apps` array.
2. Create `apps/<name>/vercel.json` with the standard shape:

   ```json
   {
     "$schema": "https://openapi.vercel.sh/vercel.json",
     "ignoreCommand": "npx -y turbo-ignore@<pinned> @rando/<name>",
     "git": {
       "deploymentEnabled": { "main": false, "staging": false }
     }
   }
   ```

3. Update `.github/actions/changes/action.yml` so the composite emits a
   per-workspace boolean for the new app (see
   [ci-per-app-preview-gating](../.notes/ci-per-app-preview-gating.spec.md)
   "Touch points" #1).
4. Extend `deploy-preview.yml`'s "Compute affected apps" step to
   include the new app.
5. Run `pnpm rando infra setup` to provision Vercel project + domains
   - 1P env-var push + native-deploy disable.

### Reading the deploy / integration-tests interaction

`integration-tests.yml` falls back to staging when a preview never
comes up (Vercel quota, deploy failure, etc.) — see
`.notes/ci-integration-tests-smart-target.spec.md`. **This means a
green `Postman collection + spec lint` check doesn't prove the PR's
own preview succeeded.** When reviewing:

- `Postman collection + spec lint` green = the deployed API
  (preview OR staging fallback) still serves a valid contract.
- `Vercel – rando-api` / `rando-web` / `rando-admin` red = the
  preview deploy itself failed; integration tests likely ran
  against staging fallback. Investigate the Vercel check, not
  the integration tests.
- `Deploy preview` (deploy-preview.yml job) red = something broke before
  the preview was created. Same story: don't trust integration
  tests as a proxy.

The redundancy is intentional — deploy success and contract
validity are independent signals and we want to surface both.

### Skipping deploys when no app changed

Two seams filter out PRs / pushes that don't change deployable code:

- **PR preview deploys** — `.github/workflows/deploy-preview.yml`'s
  `branch-deploy` job runs `.github/actions/changes`, then computes
  the affected-apps list from the composite's per-workspace outputs
  (`api`, `web`, `admin` — true when that app's own files OR a
  runtime dep changed, per Turbo's dep-graph traversal). The list
  is passed to `rando deploy branch --apps <list>` so only the
  affected apps get a preview. A PR that touches no app workspace
  (docs-only, CLI-only, etc.) skips the deploy entirely with a
  notice. **The teardown job stays unconditional** so closing a PR
  always tears down its Vercel custom domains + Cloudflare CNAMEs,
  even if it never had a preview.

  Examples of the per-app dep graph:
  - `packages/db` change → only `api` (admin/web don't depend on db)
  - `packages/maps` or `packages/ui` change → only `web`
  - `packages/api-client` / `auth` / `config` change → all three
  - `apps/admin/...` change → only `admin`

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

**Adding a new app workspace?** Two edits keep gating coherent:

1. Add an entry to the `PKG` map in `.github/actions/changes/action.yml`
   so the composite emits a per-workspace boolean for it.
2. Extend the "Compute affected apps" step in
   `.github/workflows/deploy-preview.yml` to include the new app in the
   affected-list logic.

Skipping step 1 means the workspace's coverage never gets uploaded;
skipping step 2 means the new app's preview never fires.

**Don't gate on `outputs.docs`.** `dorny/paths-filter` outputs that
true when **any** changed file matches the docs pattern, not when
**every** file is docs. A PR with a `.ts` change AND a `README.md`
update has both `docs=true` and `code=true` — a `docs != 'true'` gate
would incorrectly skip it. Use the per-workspace outputs (or
`code || shared`) for positive deploy decisions; reserve `docs` for
explicit "did docs change" questions, not "should we deploy".

**Don't use `paths-ignore` at the workflow `on:` level for deploy-preview.yml.**
It applies to every `pull_request` event type, so a PR amended to
remove all deploy-worthy changes before close would skip the workflow
entirely and orphan infra. The job-level gate above keeps teardown
safe.

Spec: `.notes/ci-per-app-preview-gating.spec.md`. Other workflows
(`lint.yml`, `typecheck.yml`, `codeql.yml`) continue to gate on the
broader `code` aggregate — they don't deploy per-app, so per-workspace
specificity isn't useful there.

### Previews are opt-in (all PRs)

Vercel's free tier caps deploys at **100 per day across the account**.
A queue of dependency PRs alone would burn that on rebases. Even for
human-authored work, most PRs don't need a preview — docs, CI,
CLI-only, refactors that don't change a route.

`deploy-preview.yml`'s `branch-deploy` job is gated to **skip every
PR unless it carries the `deploy-preview` label**:

```yaml
contains(github.event.pull_request.labels.*.name, 'deploy-preview')
```

Pre-D3 the gate was author-specific (Dependabot opt-in, humans
always); post-D3 every author opts in explicitly. Trade-off:
contributors add a label when they want a preview (one click), in
exchange for predictable quota behavior.

**Adding the label:**

```bash
gh pr edit <N> --add-label deploy-preview
```

Adding the label fires the deploy immediately (the workflow listens
on `labeled` in addition to `synchronize`). Subsequent pushes redeploy.
Label persists across rebases.

**When to add it:**

- Any UI change you want to view in a browser before merge.
- API contract changes — Postman runs against the labeled PR's
  preview, not staging fallback.
- Major dependency bumps with runtime risk (tamagui / next / react /
  clerk — see [`ci-dependabot-triage`](../.notes/ci-dependabot-triage.md)).

**When to skip:**

- Pure docs / spec / `.notes/` changes.
- Workflow / CI tweaks that don't touch app code.
- CLI-only changes — there's nothing to preview.

`teardown` stays unconditional — closing a PR always cleans up infra,
even one that never had a preview. Specs:
[`.notes/process-deploy-strategy.spec.md`](../.notes/process-deploy-strategy.spec.md)
(D3) +
[`.notes/ci-preview-quota-strategy.spec.md`](../.notes/ci-preview-quota-strategy.spec.md)
(original Dependabot opt-in, now generalized).

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
                                   sync-staging.yml (push:main)
main ◄────── PR ────── <feature>            ───────────────────► staging
  │                                                                 │
  │ workflow_dispatch + Environment reviewer                         │ deploy-staging.yml (push:staging)
  ▼                                                                 ▼
rando.id (prod, via deploy-production.yml)               staging-*.rando-id.dev
```

- Feature branches → PRs into `main` directly. Add the `deploy-preview` label to opt into a per-app preview at `<branch>-<app>.rando-id.dev` (via `deploy-preview.yml`). Previews are off by default — see "Previews are opt-in (all PRs)" above.
- Merge to `main` → fires **one** thing automatically: `sync-staging.yml` fast-forwards `staging` to `main`, which triggers `deploy-staging.yml`. Production does NOT auto-deploy — that requires `workflow_dispatch` on `deploy-production.yml` plus an Environment reviewer approval.
- Staging is a **pure mirror of main**, NOT an independent release branch. No PRs target staging, no hotfixes land on staging, no commits exist on staging that aren't on main. The auto-sync workflow refuses to overwrite divergent commits — fail-loud is intentional.
- If you ever need a real release process (cut staging independently, hotfix-on-staging), revisit `.notes/ci-staging-auto-sync.spec.md`'s "What would make us reconsider" — the model needs to change.

### Staging out of sync — recovery

The `Sync staging` workflow refuses to overwrite divergent commits — if it fails, that's the workflow telling you `staging` has commits `main` doesn't. To investigate + recover:

1. `git fetch origin main staging && git log --oneline origin/main..origin/staging` — shows what's on staging that isn't on main. If empty, the workflow's wrong (file a bug). If non-empty, decide what to do with each commit.
2. **If the divergent commits are stale and should be dropped**: Actions → `Sync staging` → Run workflow → set `force` to `true`. This is a hard `--force` push (not `--force-with-lease`). Use sparingly — it's the data-loss path.

3. **If the divergent commits are real work**: rebase them onto `main` via the normal PR flow, merge through `main`, then the next push auto-syncs staging cleanly.

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
