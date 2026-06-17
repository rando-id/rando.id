# `rando` — infrastructure CLI

A unified command-line for driving Rando.id's cloud setup (DB, dev tunnel,
deploy, DNS) without touching vendor dashboards. Architecturally
port-and-adapter: domain interfaces describe the verbs, vendor adapters
implement them.

## Quickstart (first clone)

**Brand-new machine** (macOS):

```bash
# One-time prereq (skip if you already have brew):
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Per-clone:
git clone https://github.com/rando-id/rando.id.git && cd rando.id
./scripts/bootstrap
```

That's it. `scripts/bootstrap` is a shell script that:

1. **`brew bundle install`** — installs every system dep listed in
   `scripts/Brewfile` (gh, pnpm, node@22, 1password-cli, orbstack).
2. **`pnpm install`** — JS deps + husky regenerates the hook shims via
   the `prepare` script.
3. **`node scripts/setup-cli.mjs`** — symlinks `rando` into
   `~/.local/bin` so subsequent commands work without the `pnpm`
   prefix.
4. **`rando init`** — interactive walkthrough that prompts for each
   env-var token, validates the value by calling the vendor API,
   writes to `.env`, then ends with a doctor sweep + a "next steps"
   menu.

Idempotent — re-running `./scripts/bootstrap` on an already-
bootstrapped machine is safe (every step is a no-op when already
done).

**Linux / Windows**: skip the Brewfile, install equivalents however you
manage packages, then run the remaining steps manually:

```bash
pnpm install
node scripts/setup-cli.mjs
rando init
```

Node 22+ is required. `pnpm setup:cli` is idempotent — re-run any time.
If `~/.local/bin` isn't on your PATH, the script will tell you what to add
to your shell rc.

## Invoking the CLI

After `pnpm setup:cli`:

```bash
rando <subcommand>                  # works from any directory
rando                               # bare → interactive menu
rando doctor                        # diagnostic — runs colors + a spinner
rando completion zsh > _rando       # shell tab-completion (bash | zsh | fish)
```

Without the symlink, two fallbacks still work:

```bash
pnpm rando <subcommand>             # via root package.json script
./packages/cli/bin/rando.mjs <cmd>  # explicit path
```

The bin (`packages/cli/bin/rando.mjs`) is a tiny Node wrapper that locates
the repo root from its own path, then re-execs Node with absolute paths to
`tsx` and `.env`. Result: `rando` works regardless of your current working
directory.

### Interactive prompts for missing args

Every destructive/list-able command will prompt for any positional
argument you don't pass on the command line, in a terminal context:

```bash
# All three of these prompt for "which project?" then "which branch?":
rando db branch delete
rando db connection-string
rando db sync                       # prompts for --from then --to

# Pre-fill any subset and only the rest get prompted:
rando db branch delete p1            # only prompts for branchId
rando db sync --from main            # only prompts for --to
```

Resource selectors (project IDs, branch names, app names, tunnel names,
DNS record IDs) show a typed list from the provider — no opaque IDs to
remember. Free-text args (new resource names) use a simple input prompt.
Non-TTY contexts (CI, pipes) fail loudly with `Missing required argument
<name>` instead of hanging.

### Tab completion

```bash
# bash: source from your .bashrc
rando completion bash > ~/.rando-completion.bash
echo 'source ~/.rando-completion.bash' >> ~/.bashrc

# zsh: drop into your fpath
rando completion zsh > "${fpath[1]}/_rando"

# fish:
rando completion fish > ~/.config/fish/completions/rando.fish
```

Typos surface "Did you mean…?" suggestions (`rando dbb` → `(Did you mean db?)`).

## Configuration

Env vars (set in your shell or in repo-root `.env`):

| Variable                   | Used by                                              |
| -------------------------- | ---------------------------------------------------- |
| `NEON_API_KEY`             | `db`                                                 |
| `CLOUDFLARE_API_TOKEN`     | `tunnel`, `dns`                                      |
| `CLOUDFLARE_ACCOUNT_ID`    | `tunnel`                                             |
| `VERCEL_TOKEN`             | `deploy`                                             |
| `VERCEL_TEAM_ID`           | `deploy` (optional)                                  |
| `GITHUB_TOKEN`             | `issues` (when tracker.kind="github")                |
| `JIRA_BASE_URL`            | `issues` (when tracker.kind="jira")                  |
| `JIRA_EMAIL`               | `issues` (when tracker.kind="jira")                  |
| `JIRA_API_TOKEN`           | `issues` (when tracker.kind="jira")                  |
| `POSTMAN_API_KEY`          | `api postman sync` (optional)                        |
| `OP_SERVICE_ACCOUNT_TOKEN` | CI only — `1password/load-secrets-action` (optional) |

A repo-root `.env` is auto-loaded via Node's `--env-file-if-exists` flag
in the bin shebang — no `source .env` needed. Shell-exported vars still
win when both are set.

Each command only requires the env vars its subsystem touches — so partial
configs work. You can run `rando db ...` with just `NEON_API_KEY` set.

### How to get each token

#### `NEON_API_KEY`

1. Sign in at <https://console.neon.tech>.
2. Click your account avatar (top left) → **Settings** → **API keys**.
3. **Generate new API key**. Name it something like `rando-cli`.
4. Copy the value immediately — Neon only shows it once.
5. Personal API keys can manage all projects you own; if you've put `rando`
   under an organization, scope the key to that org instead.

Reference: <https://neon.tech/docs/manage/api-keys>

#### `CLOUDFLARE_API_TOKEN`

You want a **scoped token**, not the global API key.

1. Sign in at <https://dash.cloudflare.com>.
2. In the left-hand nav: **Manage Account → Account API Tokens**. (The old
   profile-menu path was deprecated — Cloudflare moved this in late 2025.)
3. **Create Token → Create Custom Token**.
4. **Permissions** — each row has three dropdowns: **scope** (Account /
   Zone / User), **category**, **level** (Edit / Read). Add **four** rows
   using **+ Add more**. The category dropdown has a search box — type the
   values below verbatim to avoid the lookalike entries.

   | Scope   | Category (search this) | Level | Notes                                                                                                                                                                                                                                                                                             |
   | ------- | ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Account | `Cloudflare Tunnel`    | Edit  | If only `Argo Tunnel (legacy)` shows up, pick that — same API, old name.                                                                                                                                                                                                                          |
   | Account | `Access: Apps`         | Edit  | Tunnel routes are modeled as Access self-hosted apps. Do **not** pick the standalone `Access` row.                                                                                                                                                                                                |
   | Account | `Access: Policies`     | Edit  | Needed to attach the `Bypass` policy to tunnel routes.                                                                                                                                                                                                                                            |
   | Zone    | `DNS`                  | Edit  | This is a **Zone**-level permission, not Account. At Account scope the `DNS & Zones` group is all wrong (`Account DNS settings`, `DNS firewall`, `DNS view`, `Registrar domains` — none manage zone records). Switch the scope dropdown to **Zone** first, then you'll see the right `DNS` entry. |

5. **Account Resources**: limit to your account.
6. **Zone Resources**: select **Include → Specific zone**, then add both
   `rando-id.dev` and `rando.id`. (Or just "All zones" if the token is
   single-purpose — slightly broader but simpler.)
7. **Continue to summary → Create Token → Copy** the value into your
   `.env` immediately — Cloudflare only displays it once.

Reference: <https://developers.cloudflare.com/fundamentals/api/get-started/create-token/>

Verify by running the following:

```
curl -X GET "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/tokens/verify" \
     -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
```

#### `CLOUDFLARE_ACCOUNT_ID`

1. From <https://dash.cloudflare.com>, pick any domain in your account.
2. The right-hand sidebar (**API**) shows **Account ID** — copy it.
3. Alternative: it's the UUID in the URL after `/accounts/` when you're on
   the dashboard home for an account.

#### `VERCEL_TOKEN`

1. Sign in at <https://vercel.com>.
2. Avatar (top right) → **Account Settings** → **Tokens**, or go to
   <https://vercel.com/account/tokens>.
3. **Create Token**:
   - Token name: `rando-cli`
   - Scope: pick the team or personal account where the projects will live
   - Expiration: pick what you're comfortable with (recommend 1 year and
     rotate, not "no expiration")
4. **Create**, then copy the token.

Reference: <https://vercel.com/docs/rest-api#authentication>

#### `GITHUB_TOKEN` (default tracker)

Only needed when `tracker.kind` in `rando.config.json` is `"github"` —
which is the default.

- **Locally**: `gh auth token` if you've signed in with the `gh` CLI;
  copy it into `.env`. Alternatively generate a fine-grained PAT at
  <https://github.com/settings/personal-access-tokens/new>, scoped to
  the target repo with **Read+Write** on **Issues** and **Read** on
  **Metadata**.
- **In CI**: nothing to set. `${{ secrets.GITHUB_TOKEN }}` is provided
  automatically by GitHub Actions and the workflow already wires it.

Verify with:

```bash
pnpm rando issues doctor
```

#### `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (when tracker.kind="jira")

Only needed when `tracker.kind` in `rando.config.json` is `"jira"`. Your
Jira Cloud workspace URL, the email on your Atlassian account, and a
personal API token (NOT your password).

1. **`JIRA_BASE_URL`**: open <https://admin.atlassian.com>, pick your
   workspace; the URL bar shows `https://<workspace>.atlassian.net` —
   that's the value. No trailing slash.
2. **`JIRA_EMAIL`**: the email you sign in to Atlassian with.
3. **`JIRA_API_TOKEN`**: at
   <https://id.atlassian.com/manage-profile/security/api-tokens>:
   - **Create API token**.
   - Label it `rando-cli`. Atlassian no longer offers an expiration field
     for personal tokens — rotate manually if you need to.
   - **Copy** the token immediately; Atlassian only shows it once.

Tokens are per-user, not per-project. They authenticate as you, so they
inherit your project permissions.

Verify by running:

```bash
pnpm rando issues doctor
```

Doctor prints your authenticated identity, the configured project /
repo, the statuses the adapter exposes, and the lifecycle map from
`rando.config.json` with any unmapped slots called out.

Reference: <https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/>

#### `POSTMAN_API_KEY` (optional — only needed for `api postman sync`)

If you're not using Postman, leave this unset and skip the `api postman`
commands; everything else works.

1. Sign in at <https://web.postman.co>.
2. Avatar (top right) → **Settings** → **API keys**, or go to
   <https://web.postman.co/settings/me/api-keys>.
3. **Generate API key**. Label it `rando-cli`.
4. Copy the value — Postman only displays it once.
5. The key uses `X-Api-Key` header auth (no `Bearer` prefix); `rando init`
   validates it for you by calling `GET /me`.

`rando init` will also offer to pick a default workspace and write the id
into `rando.config.json` (`postman.workspaceId`) so `rando api postman sync`
runs with no flags by default.

#### `VERCEL_TEAM_ID` (only if your projects live in a team)

If you're using a personal Vercel account, **leave unset**.

If you're on a team:

1. <https://vercel.com> → switch to the team in the top-left dropdown.
2. **Settings → General** for the team.
3. The **Team ID** is shown near the top. Copy it (or grab it from the URL
   on the team settings page).

## First run — verify everything, then dry-run

Once the env vars are set, walk this checklist before doing any real
provisioning. Every step here is **safe** (read-only or `--dry-run`) until
the final section.

### 1. Sanity-check each token (read-only)

```bash
pnpm rando db project list                    # → NEON_API_KEY
pnpm rando tunnel list                        # → CLOUDFLARE_API_TOKEN + ACCOUNT_ID
pnpm rando dns record list rando-id.dev       # → CLOUDFLARE_API_TOKEN (DNS scope)
pnpm rando deploy app list                    # → VERCEL_TOKEN
```

Each should return either an empty list (fresh accounts) or your existing
resources. Failure modes:

- `MissingConfigError: NEON_API_KEY…` — the var didn't get loaded from `.env`.
  The CLI reads from `process.env` — make sure the shell exported it:
  ```bash
  set -a; source .env; set +a
  ```
- `401` / `403` — the token's permissions are wrong; revisit the
  ["How to get each token"](#how-to-get-each-token) section.

### 2. Verify `rando.config.json`

The repo ships with a committed `rando.config.json` at its root — same
Neon project, same domains, same apps for every contributor. Nothing to
copy or edit. If you're working from a personal fork, change `repo` to
`<your-handle>/rando`. Schema is documented in the
[`infrastructure` command reference](#infrastructure--one-shot-orchestration).

### 3. Dry-run the orchestration

```bash
pnpm rando infra setup --dry-run
```

Prints the plan (config path, project name, env list, app list) and stops
before any provider call. If the config is malformed, you'll see a
`SetupConfigError` here instead of mid-run.

### 4. Real run — start narrow

Do **dev** first. Lowest blast radius: just creates the Cloudflare Tunnel +
routes. No DB, no domains, no Vercel projects.

```bash
pnpm rando infra setup --env dev
```

Every `✓` line in the output is one real API call. If something errors
partway through, fix and re-run — the whole orchestration is idempotent
(every step checks "exists?" before creating).

### 5. Then staging

```bash
pnpm rando infra setup --env staging
```

Creates the Neon project + `staging` branch, enables PostGIS, creates one
Vercel project per app, attaches `staging-*.rando-id.dev` domains bound to
the `staging` git branch, and adds the matching Cloudflare CNAMEs.

### 6. Then production

```bash
pnpm rando infra setup --env production
```

Same shape on the production zone (`rando.id`). The `prodApex: true` app
takes the apex; the rest take `<name>.rando.id` subdomains.

### After setup — what's still manual

The orchestrator intentionally skips secrets and migrations. Once the
projects exist:

1. Set secret env vars on each Vercel project (`CLERK_SECRET_KEY`, etc.):
   ```bash
   pnpm rando deploy env set rando-api CLERK_SECRET_KEY sk_live_... --scope production
   ```
2. Apply DB migrations against each Neon branch:
   ```bash
   DATABASE_URL="$(pnpm rando db connection-string <proj> <branch> --pooled --json | jq -r .url)" \
     pnpm --filter @rando/db db:migrate
   ```
3. Wire the Clerk webhooks via `rando clerk webhook setup --env <env>` (see
   [MAINTAINING.md → Clerk](../../.github/MAINTAINING.md#clerk)).

## Commands

Every command takes `--json` to emit raw JSON (good for piping into `jq` or
chaining commands).

### `db` — database

```
rando db project create <name> [--region <id>]                   [-y/--yes]  ⚠ escape-hatch
rando db project list
rando db project delete <projectId>                              [-y/--yes]  ⚠ escape-hatch
rando db branch create <projectId> <name> [--from <srcBranchId>]
rando db branch list <projectId>
rando db branch delete <projectId> <branchId>                    [-y/--yes]
rando db connection-string <projectId> <branchId> [--pooled]
rando db extension-enable <projectId> <branchId> <extension>
rando db sync --from <branch> --to <branch>                      [-y/--yes]
rando db copy --from-conn <url> --to-conn <url> [--schema-only]   [-y/--yes]
```

`db sync` resets one Neon branch to match another (e.g. `--from main
--to staging` refreshes staging from production data). Destructive — the
destination branch is overwritten in place. Neon preserves the previous
state under an automatic snapshot. Loud `WARNING` printed when
`--to=main` since that overwrites production.

`db copy` is the cross-project escape hatch — pipes `pg_dump |
pg_restore` between two arbitrary Postgres connection strings. Use when
`db sync` doesn't apply (different Neon projects, or copying out to a
non-Neon Postgres). Requires `pg_dump`/`pg_restore` on PATH at Postgres
16+ (Neon's server version). `--schema-only` for DDL-only copies;
`--no-clean` skips the default `pg_restore --clean --if-exists`. Common
recipe:

```bash
SRC=$(rando db connection-string $SRC_PROJ $SRC_BR --pooled --json | jq -r .url)
DST=$(rando db connection-string $DST_PROJ $DST_BR --pooled --json | jq -r .url)
rando db copy --from-conn "$SRC" --to-conn "$DST"
```

⚠ **`db project create` / `db project delete` are escape-hatch commands.**
The Rando Neon project is bootstrapped by `rando infra setup` reading
`rando.config.json`, and should be torn down via the Neon dashboard (so you
visually confirm what you are nuking). Both commands print a warning and
prompt before running. Reach for them only when managing one-off Neon
projects unrelated to the orchestrated Rando stack.

### `tunnel` — dev tunnel

```
rando tunnel create <name>
rando tunnel list
rando tunnel delete <name>                                       [-y/--yes]
rando tunnel token <name>
rando tunnel route add <tunnel> <hostname> <service>
rando tunnel route list <tunnel>
rando tunnel route remove <tunnel> <hostname>                    [-y/--yes]
```

### `deploy` — app deploys

```
rando deploy app create <name> --root <path> --repo <owner/name>
rando deploy app list
rando deploy app delete <name>                                   [-y/--yes]
rando deploy env set <app> <key> <value> --scope <production|preview|development>[,...]
rando deploy env list <app>
rando deploy domain add <app> <hostname> [--branch <branch>]
rando deploy domain remove <app> <hostname>                      [-y/--yes]
rando deploy branch [<branch>] [--apps <names>] [--no-wait] [-s/--stable-url]
```

`--scope` accepts a comma-separated list — e.g. `--scope production,preview`.

#### `deploy branch` — preview deploys

```
rando deploy branch                       # current git branch, all apps
rando deploy branch feat/something        # specific branch
rando deploy branch main --apps web       # subset
rando deploy branch main --no-wait        # trigger and exit, don't poll
rando deploy branch feat/x --stable-url   # plus stable CNAMEs
```

For each configured app in `rando.config.json`, triggers a Vercel preview
deployment from the named branch, polls until the build is ready (or
errors out), and prints the preview URL. Defaults to the current git
branch when no argument is passed. Triggers and polls in parallel — wall
time is bounded by the slowest single build, not the sum.

**`--stable-url` / `-s`** — after the build is ready, ensures a custom
Vercel domain `<branch-slug>-<app>.<nonProd-zone>` exists pinned to the
branch, and adds a matching Cloudflare CNAME → `cname.vercel-dns.com`.
Result: a stable URL that follows the latest deploy of that branch (so
you can share `feat-x-web.rando-id.dev` and it always points at the
current build). Both calls are idempotent — re-running is safe. Branch
names are slugified for DNS: `feat/x` → `feat-x`.

#### `deploy teardown` — PR cleanup

```
rando deploy teardown [<branch>] [--apps <names>] [-y/--yes]
```

Inverse of `deploy branch --stable-url`: for each app, removes the
Vercel custom domain and the Cloudflare CNAME for `<branch-slug>-<app>.<nonProd>`.
Idempotent (missing resources are treated as already-gone) so it's safe
to run from a PR-close GitHub Actions job. The preview deployments
themselves are left alone — Vercel auto-GCs them on its own retention
schedule.

```yaml
# .github/workflows/preview.yml
name: PR preview
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  preview:
    if: github.event.action != 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm setup:cli
      # Optional: spin up a fresh Neon branch off main for this PR.
      - run: rando db branch create $RANDO_PROJECT pr-${{ github.event.number }} --from main
      - run: rando deploy branch ${{ github.head_ref }} --stable-url --yes
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

  teardown:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm setup:cli
      - run: rando deploy teardown ${{ github.head_ref }} --yes
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - run: rando db branch delete $RANDO_PROJECT pr-${{ github.event.number }} --yes
        env:
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
```

Result: each PR gets its own preview URLs at predictable
`<branch-slug>-<app>.rando-id.dev` and (optionally) a fresh Neon branch.
Both vanish on PR close.

The repo ships this workflow at [`.github/workflows/preview.yml`](../../.github/workflows/preview.yml) —
the Neon-branch steps are commented out by default; uncomment + set
`RANDO_NEON_PROJECT_ID` as a repo variable to enable per-PR Neon
branches.

### `dev` — local dev orchestrator

```
rando dev                              # all apps + cloudflared + preflight
rando dev web                          # api auto-starts as dep, web runs on top
rando dev web admin                    # same — api auto-starts once
rando dev api                          # api only
rando dev web --no-tunnel              # skip cloudflared (if you're not testing webhooks)
rando dev web --no-preflight           # skip the Docker / env checks
```

Wraps the muscle-memory of "is Docker up? is cloudflared up? did I run
`pnpm dev`?" into a single command:

1. **Preflight** — checks the Docker daemon is reachable and
   `CLOUDFLARE_TUNNEL_TOKEN` is set. Fails fast with actionable hints
   if either is missing.
2. **Cloudflared** — spawns `docker compose --profile tunnel up` (your
   existing compose profile) so localhost is reachable at
   `dev-*.rando-id.dev`. Skip with `--no-tunnel`.
3. **Apps** — spawns `pnpm --filter @rando/<app> dev` for each
   requested app. `web`, `admin`, and `native` all depend on `api` —
   request any of those and `api` starts automatically.
4. **Colored log mux** — each child's stdout/stderr is prefixed with
   `[<name>]` in a distinct color so the multiplexed stream is readable.
5. **Graceful shutdown** — `Ctrl+C` sends `SIGTERM` to every child and
   waits for them to exit before the supervisor returns.

If any child exits with a non-zero code, the others are torn down and
the supervisor exits non-zero too.

### `api` — API surface tooling

```
rando api postman sync     [--spec <urlOrPath>] [--workspace <id>] [--name <name>] [--config <path>] [--json]
rando api postman generate [--spec <urlOrPath>] [--out <path>] [--name <name>] [-f/--force] [--json]
rando api postman push     [--collection <path>] [--env-dir <path>] [--no-envs] [--workspace <id>] [--config <path>] [--json]
```

Two complementary flows:

- **`generate`** is the canonical one for the test loop. It runs
  `openapi-to-postmanv2` against the spec and writes a Postman v2.1
  collection JSON file to disk (default: `postman/rando-api.postman_collection.json`).
  No Postman API call. The file is checked into the repo and used by
  `pnpm test:api` (postman-cli) and the `api-tests.yml` workflow. Hand-author
  `pm.test()` assertions on top of the generated requests; regenerate
  only when the contract changes (and merge any test edits back in by
  hand — there's no auto-merge today). The command **refuses to
  overwrite an existing file** unless `--force` is passed — pass
  `--out /tmp/regen.json` first to diff against the canonical file.
- **`postman push`** mirrors the local collection JSON (with
  hand-authored `pm.test()` blocks intact) + every Postman environment
  JSON under `postman/environments/` into the configured workspace.
  Uses `PUT` when an entity with the same name already exists, so
  collection + environment uids stay stable across pushes — Postman
  Monitors and shared links won't break. Different from `sync`, which
  converts from OpenAPI and rotates the uid. Pass `--no-envs` to push
  only the collection.
- **`postman sync`** is for UI exploration. It pushes the OpenAPI spec
  into a Postman workspace as a collection so you can poke at endpoints
  in the Postman app. The sync is idempotent: if a collection with the
  same name already exists, it's deleted and re-imported. The collection
  id changes per sync, so don't pin secrets to it.

Defaults:

- `--spec` is `http://localhost:4000/v1/openapi.json`. Point it at a
  deployed env or a local file when needed.
- `--out` (generate only) is `postman/rando-api.postman_collection.json`.
- `--workspace` (sync only) reads from `postman.workspaceId` in
  `rando.config.json` when omitted. `rando init` will help you pick
  one and write it.
- `--name` defaults to the spec's `info.title` (generate) or `"Rando API"`
  (sync).

`POSTMAN_API_KEY` is only required for `sync`. `generate` is pure
file I/O — runnable in CI with no secrets.

#### Auth tokens via 1Password (`op run`)

Postman has a native 1Password integration, but it's gated behind the
Enterprise plan with the Advanced Security Administration add-on
(see [Postman docs](https://learning.postman.com/docs/use/postman-vault/1password)).
For Free/Pro tiers, the same end state is achievable via the
1Password CLI:

```bash
# One-time setup
cp postman/.op.env.example postman/.op.env
$EDITOR postman/.op.env             # adjust op:// references to your vault paths

# Per-run
op signin                           # if not already
op run --env-file=postman/.op.env -- pnpm test:api
```

`op run` reads the `.op.env` file, replaces every `op://...` reference
with the live value from 1Password, and invokes the command with those
values in its environment. The Postman CLI picks up `$AUTH_TOKEN` via the
`test:api` script and exposes it inside the collection as
`{{authToken}}`. Tokens never touch disk and never appear in shell
history. `.op.env` itself is gitignored — per-developer vault names
stay out of the repo.

For the Postman desktop UI, use **Settings → Vault** (Postman's own
local Vault Secrets, available on Free) — paste a value copied from
1Password's desktop app once, reference it as `{{vault:authToken}}` in
the environment. The two flows compose: 1Password is the source of
truth, `op run` handles the CLI/CI path, Postman's local vault is the
UI convenience.

### `dns` — DNS records

```
rando dns record add <zone> <type> <name> <content> [--ttl <sec>] [--proxied]
rando dns record list <zone>
rando dns record remove <zone> <recordId>                        [-y/--yes]
```

`<type>` is one of `A`, `AAAA`, `CNAME`, `TXT`, `MX` (case-insensitive).
TTL `1` = "auto".

### `issues` — issue-tracker integration (GitHub Issues / Jira)

```
rando issues list [--mine] [--all] [--limit <n>]
rando issues show <KEY>
rando issues create [summary] [-d <text>] [--label <label>...] [-m <milestone>]
rando issues comment [KEY] [body...]
rando issues pick [--limit <n>] [--reset]
rando issues refs <range> [--json]
rando issues lifecycle <KEY> <slot> [-m <body>]
rando issues backfill [--since <sha>] [--apply] [--label <l>] [--limit <n>]
rando issues doctor
```

The active adapter is picked by `tracker.kind` in `rando.config.json` —
either `"github"` (default) or `"jira"`. Both implement the same nine
commands; only the project/repo + auth differ. Issue keys are
`"#42"`-style for GitHub or `"RANDO-42"`-style for Jira; the CLI doesn't
care which.

**`list`** defaults to open issues in the configured repo/project.
`--mine` filters to issues assigned to you. `--all` includes closed.

**`show KEY`** prints a one-issue summary (status, assignee, updated,
URL).

**`create [summary]`** opens a new issue. `-d "..."` for body, `--label`
(repeatable) for vendor labels, `-m "<id-or-title>"` to attach a
milestone (GitHub only — accepts the numeric id `2` or the exact title
`"v0.1 — Feature parity"`; Jira raises a clear error).

**`comment [KEY] [body...]`** appends a comment. Body args are joined
with spaces:
`rando issues comment '#7' Deployed to https://staging-web.example.com`.

**`pick`** is what the pre-commit hook calls. Lists your open issues
plus two extras — `+ Create a new ticket` and `Skip for this branch (no
ticket)` — and caches the choice in `git config branch.<name>.jira-key`
(name kept for backward compat with previously-cached values).
Subsequent commits on the branch reuse the cached key without
re-prompting. `--reset` clears the cache.

**`refs <range>`** prints every distinct issue key referenced by commits
in a git range. Used by CI to discover issues touched by a PR:

```bash
rando issues refs main..HEAD                # → "#1\n#2" or "RANDO-1\nRANDO-2"
rando issues refs ${{ base.sha }}..${{ head.sha }} --json
```

**`lifecycle <KEY> <slot>`** moves an issue through one of the
lifecycle slots: `in-progress`, `in-review`, `done`. Adapters map these
to:

- **GitHub**: `in-progress` / `in-review` → `state=open` + the
  configured `status:*` label (others stripped). `done` → `state=closed`
  with `state_reason=completed`.
- **Jira**: looks up the configured transition name/id in
  `tracker.jira.transitions` and fires it.

Idempotent — when the issue is already in the target state, the
command no-ops and `-m "..."` (if passed) still posts a comment so the
deploy-URL message lands on PR-synchronize re-fires.

**`backfill`** walks `git log --first-parent` newest-first and creates
one issue per commit, labeled `backfill` (overridable) and moved
straight to the done state. Defaults to dry-run; pass `--apply` to
actually create. `--since <sha>` skips older commits; `--limit <n>`
caps the count.

**`doctor`** verifies tracker credentials, prints the configured
repo/project, and lints which lifecycle slots are resolvable.

#### Commit hooks

Two hooks live under `.husky/`, both committed and auto-installed via
`husky`'s `prepare` script on `pnpm install`:

- **`.husky/pre-commit`** runs `lint-staged`, then — if a tracker is
  configured and no issue is cached for the current branch — runs
  `rando issues pick --from-hook` to prompt. This is the picker step.
  It lives in pre-commit (not prepare-commit-msg) because lint-staged's
  stash/restore dance breaks the TTY for later hooks.
- **`.husky/prepare-commit-msg`** is a 10-line script that just reads
  `git config branch.<name>.jira-key` and appends `Refs: <KEY>` to the
  commit message. No prompts, no network, no TTY interaction.

What runs on every `git commit`:

1. lint-staged formats/lints staged files.
2. If `branch.<name>.jira-key` is unset and `rando issues pick --check`
   says the tracker is configured, the picker runs. Choices: pick an
   existing issue, `+ Create a new ticket`, or `Skip for this branch
(no ticket)` (which caches the `skip` sentinel and exits 0).
3. prepare-commit-msg reads the cache and appends `Refs: <KEY>` —
   unless the value is `skip`, in which case no footer is added.

**Escape hatches**:

- `RANDO_NO_JIRA=1 git commit ...` — bypasses both hooks. Useful for
  one-off commits the picker shouldn't apply to (typos, hook tweaks).
- `git config branch.<name>.jira-key skip` — per-branch opt-out, set
  once and forgotten. Default for `main` in solo-dev repos.

**Enforcement**: when the tracker IS configured (--check passes) and
nothing is cached and the picker errors/dismisses, pre-commit exits 1
and the commit is rejected.

#### CI sync workflows

Two workflows handle the lifecycle on PR events:

- **`.github/workflows/issues-sync.yml`** — on every `pull_request`
  event, runs `rando issues refs base..head` to discover issues, then
  `rando issues lifecycle <KEY> in-progress` on opened / synchronize /
  reopened, or `... done --message "Merged in #N (<url>)"` on
  close-with-merged.
- **`.github/workflows/preview.yml`** — after the Vercel branch deploy
  succeeds, runs `rando issues lifecycle <KEY> in-review --message
"<deploy urls>"` for each referenced issue.

**Auth**: GitHub Issues uses `${{ secrets.GITHUB_TOKEN }}` (auto-
provided by Actions, no setup). Jira needs `JIRA_BASE_URL`,
`JIRA_EMAIL`, `JIRA_API_TOKEN` as repo secrets.

**Disable**: set repo variable `TRACKER_ENABLED=false` to disable
both workflows without removing them.

Both are tolerant: each `lifecycle` call falls back to `echo
"(non-fatal: $key)"` on failure so one stuck issue doesn't fail the
whole job, and `lifecycle`'s built-in idempotency means PR
synchronize re-fires don't error on issues already past the target
state.

#### Switching trackers

Flip `tracker.kind` in `rando.config.json` between `"github"` and
`"jira"`, fill in the matching env vars, and you're done. Both
adapters live in the codebase side-by-side; cached `branch.<name>.
jira-key` values from the previous tracker stay put (just legacy text
in git config) and are overwritten by the next picker pick.

### `secrets` — 1Password ↔ `.env` bridge

```
rando secrets sync [--env <local|staging|prod>] [--env-file <path>] [--config <path>] [-f/--force]
rando secrets set  <VAR> [--value <v>] [--env <list>|--all] [--config <path>]
rando secrets push <VAR> [--from <env>] [--ref <op-ref>] [--repo <owner/name>] [--config <path>]
```

The CLI treats **1Password as the source of truth** and `.env` as a
local cache. **One vault per environment** (local/staging/prod) so
dev/staging/prod credentials can't cross-contaminate — vault UUIDs
live in `rando.config.json` under `secrets.vaults`.

**`sync`** pulls every var listed in the env-token table from the
target environment's vault into `.env`. Defaults to `local`; pass
`--env staging` or `--env prod` only when you need to debug another
environment's values locally. Skips vars already set unless `--force`.

**`set <VAR>`** stores a value across one or more environments at
once — `--env local,staging,prod` for a list, `--all` for every
configured env, or skip both for an interactive multi-select.
Prompts (masked) for the value when `--value` isn't passed.
Upserts: edits the existing item if found, creates if not.

**`push <VAR>`** reads a secret from 1Password and writes it to
GitHub Actions repo secrets via `gh secret set`. Solves the
`OP_SERVICE_ACCOUNT_TOKEN` bootstrap: CI can't read from 1Password
until it has the service-account token, which has to come from
somewhere `gh` can reach. Defaults to reading from the `local` vault
and pushing to the repo declared in `rando.config.json`. `--ref` lets
you read from a vault that isn't in the config (e.g. your Personal
vault, where you stash the service-account token). The value is
piped via stdin so it never appears in argv / shell history / `ps`.

Canonical one-shot for the CI bootstrap:

```bash
op signin
gh auth login
rando secrets push OP_SERVICE_ACCOUNT_TOKEN \
  --ref op://Personal/OP_SERVICE_ACCOUNT_TOKEN/credential
```

See [CONTRIBUTING.md → Bootstrapping `OP_SERVICE_ACCOUNT_TOKEN` for CI](../../.github/CONTRIBUTING.md#bootstrapping-op_service_account_token-for-ci)
for the full bootstrap (creating the service account, storing the
token in 1Password, rotation).

Convention (set in `rando.config.json`'s `secrets` block):

- **account**: 1Password account UUID passed as `--account` on every
  `op` call. Found via `op account list --format=json`.
- **field**: `credential` (1Password's default for API credentials).
- **vaults.{local,staging,prod}**: vault UUIDs. `local` is required;
  staging/prod are optional until you need them.
- **item title** === env var name (`NEON_API_KEY` → an item literally
  called `NEON_API_KEY` inside each environment's vault).

So `NEON_API_KEY` in local resolves to
`op://<local-vault-uuid>/NEON_API_KEY/credential`. Zero per-secret
config — adding a new env var just means adding the item with that
name to whichever environment vaults need it.

`rando init` also tries 1Password (local vault) before each prompt:
if you're signed in via `op signin` and the item exists, the var is
fetched silently and the prompt is skipped. Pass `--no-1password` to
disable.

### `init` and `doctor`

```
rando init [--no-1password]               # interactive bootstrap (first clone)
rando doctor [--skip-tracker]             # full read-only health check
```

**`rando init`** is what to run the first time you clone the repo —
or any time you set up the project on a new machine. It:

1. Copies `.env.example` → `.env` if it isn't there yet.
2. Runs the env-var checks to find what's missing or invalid.
3. For each unset or invalid token, prompts interactively, validates
   the value by calling the vendor API, then writes it to `.env`.
4. Finishes with a full doctor sweep so you see what's still on the
   table (e.g. local tools like `pg_dump` you might want to install).

**`rando doctor`** is the read-only diagnostic — run it anytime to see
the current health of the setup. It walks six surfaces:

| Section  | What it checks                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Env      | Every `*_TOKEN` / `*_API_KEY` from `.env.example` — presence + validity (hits the vendor API).                                              |
| Config   | `rando.config.json` parses, `repo` is well-formed, `tracker` block present.                                                                 |
| Hooks    | `.husky/_/` shims exist, `core.hooksPath` is set, all three hook files present + executable.                                                |
| Local    | Node ≥22, `rando` on PATH, `gh` / `pg_dump` / `docker` installed (warnings, not failures, since each is only needed for specific commands). |
| Tracker  | Delegates to `rando issues doctor` for auth + lifecycle-map lint.                                                                           |
| Secrets  | `op` CLI signed in + `secrets` block present in `rando.config.json`. Warn (not fail) — 1Password is optional.                               |
| Terminal | `isTTY` + `chalk.level` (preserved from the old terminal-only doctor).                                                                      |

Each row shows `✓` / `⚠` / `✗`. Doctor exits non-zero on any `✗` so you
can wire it into CI as a setup gate. Use `--skip-tracker` to skip the
tracker probe in environments where it isn't configured.

### `completion`

```
rando completion <bash|zsh|fish>          # shell tab-completion script
```

Emits a tab-completion script for the named shell — pipe into your
shell's completion path (see "Tab completion" above).

### Destructive commands

Every command that deletes or removes a resource prompts for confirmation
before calling the provider. Pass `-y` / `--yes` to skip the prompt for
scripted or CI use. `infra destroy` follows the same convention. Production
infrastructure is never destroyable via the CLI — see the `infra destroy`
section below.

### `infrastructure` — one-shot orchestration

```
rando infrastructure setup [--env <envs>] [--apps <names>] [--config <path>] [--dry-run]
rando infra setup …             # alias
```

Both `setup` and `destroy` print a timing summary at the end
(`infrastructure setup complete. (4m12s)`) — handy for tracking how long
your infra changes actually take across the providers.

Reads `rando.config.json` at the repo root and provisions everything: Neon
project + branches, Cloudflare Tunnel + routes, Vercel projects + domains,
Cloudflare DNS records. Every step is idempotent — re-running after a
partial failure picks up where it left off.

Defaults to all environments (`dev,staging,production`) and all apps in
the config. Narrow with `--env staging` or `--apps api,admin`. `--dry-run`
prints the plan without calling any provider.

What each env actually provisions:

| `--env`      | Tunnel | Neon project + branch | Vercel project + DNS |
| ------------ | :----: | :-------------------: | :------------------: |
| `dev`        |   ✓    |           —           |          —           |
| `staging`    |   —    |     ✓ (`staging`)     |          ✓           |
| `production` |   —    | ✓ (`main` + PostGIS)  |          ✓           |

`dev` is intentionally tunnel-only — apps run on your laptop and the tunnel
exposes them to the internet. Personal Neon branches for dev are a manual
step: `rando db branch create <yourname> --from main`.

The config file lives at the repo root as
[`rando.config.json`](../../rando.config.json) and is checked in — it's
shared metadata, not per-contributor. Schema (zod-validated):

```jsonc
{
  "project": "rando",
  "repo": "your-github-handle/rando",
  "tunnel": "rando-dev",
  "domains": { "nonProd": "rando-id.dev", "production": "rando.id" },
  "apps": [
    { "name": "api", "rootDirectory": "apps/api", "port": 4000 },
    { "name": "web", "rootDirectory": "apps/web", "port": 3000, "prodApex": true },
    { "name": "admin", "rootDirectory": "apps/admin", "port": 3100 },
  ],
  // Optional — enables `rando jira` + the prepare-commit-msg hook.
  // Run `rando jira doctor` to discover what transitions exist in your
  // workflow, then fill in the lifecycle map below (name OR transition id).
  "jira": {
    "projectKey": "RANDO",
    "transitions": {
      "inProgress": "Start progress",
      "inReview": "Deploy to staging",
      "done": "Done",
    },
  },
}
```

`prodApex: true` puts one app on the production apex (`rando.id`) instead
of a subdomain. Staging always uses the `staging-<name>` pattern.

The `jira` block is optional. Without it, `rando jira` commands still work
for ad-hoc lookups but can't auto-transition through the Rando lifecycle
(PR opened → In Progress, branch deploy → In Review, merge → Done)
because the matching transition ids aren't predictable per-project.

#### Destroy

```
rando infra destroy --env <dev|staging> [--apps <names>] [--yes] [--dry-run]
```

Inverse of `setup` for a single env. Always asks for confirmation unless
`--yes` is passed.

| `--env`      | What gets removed                                                                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`        | Per-app tunnel routes, then the tunnel itself (`cascade=true`, so Cloudflare also drops the tunnel's DNS records).                                                                                       |
| `staging`    | Per-app: Vercel staging domain + Cloudflare CNAME. Then the Neon `staging` branch. Shared Vercel projects and the Neon project stay (production depends on them).                                        |
| `production` | **Refused** — the CLI throws `ProductionDestroyForbiddenError` and exits non-zero. Tear production down by hand in the Neon, Vercel, and Cloudflare dashboards so you see exactly what you are deleting. |

Like `setup`, every step is idempotent — missing resources emit
`↺ already absent` and don't fail the run.

**What it does, per environment:**

- **dev** — creates the Cloudflare Tunnel (if missing), adds a tunnel
  route for each app at `dev-<name>.<nonProd>` → `host.docker.internal:<port>`.
  Prints the next step (`rando tunnel token <name>`) so you can pipe the
  token into `.env`.
- **staging** — creates the Neon project (if missing), forks a `staging`
  branch off `main`, enables PostGIS on it. For each app: creates the
  Vercel project, attaches `staging-<name>.<nonProd>` bound to the
  `staging` git branch, adds the matching Cloudflare CNAME.
- **production** — same as staging but uses the `main` branch + the
  production domain. The `prodApex` app gets `@` (apex CNAME); the others
  get `<name>.<prod>`.

**What it does NOT do:**

- Set secret env vars on Vercel (Clerk keys etc.) — those still need to
  be set manually with `rando deploy env set` once you have them.
- Apply DB migrations — run `pnpm --filter @rando/db db:migrate` against
  the connection string from `rando db connection-string …` after setup.
- Touch Clerk (no Clerk adapter in v1).

## Examples

Set up Neon project + staging branch:

```bash
PROJECT_ID=$(rando db project create rando --json | jq -r .id)
STAGING=$(rando db branch create $PROJECT_ID staging --json | jq -r .id)
rando db extension-enable $PROJECT_ID $STAGING postgis
rando db connection-string $PROJECT_ID $STAGING --pooled
```

Add a Cloudflare Tunnel route:

```bash
rando tunnel route add rando-dev dev-api.rando-id.dev http://host.docker.internal:4000
```

Wire up a Vercel project end-to-end:

```bash
rando deploy app create rando-api --root apps/api --repo me/rando
rando deploy env set rando-api DATABASE_URL "$(rando db connection-string $PROJECT_ID main --pooled --json | jq -r .url)" --scope production
rando deploy domain add rando-api api.rando.id
```

## Architecture

```
src/
├── cli.ts            commander entry; dispatches subcommands
├── config.ts         lazy adapter factory + env validation
├── domain/           interfaces — the swap point
│   ├── db.ts
│   ├── tunnel.ts
│   ├── deploy.ts
│   ├── dns.ts
│   └── errors.ts
├── adapters/         vendor-specific implementations
│   ├── neon.ts
│   ├── cloudflare-tunnel.ts
│   ├── cloudflare-dns.ts
│   └── vercel.ts
├── commands/         commander glue, one file per domain
│   ├── db.ts
│   ├── tunnel.ts
│   ├── deploy.ts
│   └── dns.ts
└── __tests__/        vitest specs
```

Swap a provider by writing a new file in `adapters/` that implements the
domain interface, then change one line in `config.ts`. Commands and tests
don't change.

## Development

```bash
pnpm --filter @rando/cli typecheck
pnpm --filter @rando/cli test
pnpm --filter @rando/cli test:watch
pnpm --filter @rando/cli lint
```
