---
status: proposed
issue: 247
---

# All GitHub infra via API — `rando vc setup` coverage map

## Why

CLAUDE.md: "Prefer automation. If something must stay manual, document
it in MAINTAINING.md AND consider building a `rando` subcommand for it
next time." Today's GH setup has automation gaps that block new-app
onboarding from being one-shot:

- **Ruleset** — created manually via GH UI per repo
- **Environments + required reviewers** — manual repo Settings → Environments
- **Environment secrets + variables** — manual UI entry (or 1P-side push)
- **Labels** (the `area:*`, `app:*`, `type:*`, `deploy-preview` set) — partly applied by Dependabot, otherwise manual
- **Branch protection rules** — partly auto via ruleset, partly manual
- **Repo settings** — squash-merge-only, allow auto-merge, default branch, delete branch on merge: manual
- **CODEOWNERS** — file missing entirely
- **Repo secrets** (the bootstrap PAT, OP_SERVICE_ACCOUNT_TOKEN) — manual

`rando vc setup` was filed as #222 to fix this. This spec is the surface
map: what endpoints, what shape the command takes, what's already covered
in `gh-cli.ts` vs gaps.

## Surface map

### Already covered (adapter exists)

`packages/cli/src/adapters/gh-cli.ts` and `github-issues.ts`:

| Capability             | Adapter             | API                                   |
| ---------------------- | ------------------- | ------------------------------------- |
| Create / update issues | github-issues.ts    | `POST /repos/{owner}/{repo}/issues`   |
| List issues            | github-issues.ts    | `GET /repos/{owner}/{repo}/issues`    |
| Comment on issues      | github-issues.ts    | `POST /repos/.../issues/{n}/comments` |
| Read repo metadata     | gh-cli.ts           | `gh repo view` shell-out              |
| Create labels          | gh-cli.ts (partial) | `POST /repos/.../labels`              |

### Gaps — what's NOT yet adapted

| Capability                                                                           | API                                                                    | Priority                                                    |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| Create ruleset                                                                       | `POST /repos/{o}/{r}/rulesets`                                         | **P0** (blocks PR-merge gating without manual UI)           |
| Update ruleset                                                                       | `PUT /repos/.../rulesets/{id}`                                         | P0                                                          |
| Create environment                                                                   | `PUT /repos/.../environments/{name}`                                   | **P0** (D4 in [[process-deploy-strategy]] needs this)       |
| Add required reviewers to environment                                                | `PUT /repos/.../environments/{name}` (same payload, `reviewers` field) | P0                                                          |
| Set repo settings (squash-merge, auto-merge, default branch, delete-branch-on-merge) | `PATCH /repos/{o}/{r}`                                                 | P0                                                          |
| Create repo secret (encrypted via libsodium)                                         | `PUT /repos/.../actions/secrets/{name}`                                | **P0**                                                      |
| Get public key for secret encryption                                                 | `GET /repos/.../actions/secrets/public-key`                            | P0 (prereq for secret creation)                             |
| Create environment secret                                                            | `PUT /repos/.../environments/{env}/secrets/{name}`                     | **P0** ([[security-secrets-strategy]] Option B sync target) |
| Create repo variable                                                                 | `POST /repos/.../actions/variables`                                    | P1                                                          |
| Update labels (bulk apply the `area:*`/`app:*`/`type:*` set)                         | `POST /repos/.../labels` × N                                           | P1 ([[ci-pr-issue-labeler]] needs the label set to exist)   |
| Get branch protection (read existing rules)                                          | `GET /repos/.../branches/{b}/protection`                               | P2 (drift detection)                                        |
| Update repository PAT permissions / fine-grained PAT bootstrap                       | (org-level API)                                                        | P2 — likely manual forever                                  |
| Create deploy key                                                                    | `POST /repos/.../keys`                                                 | P3                                                          |
| Manage CODEOWNERS file                                                               | (regular file write, not API)                                          | P0 (just write the file)                                    |

### What stays manual (and why)

- **PAT creation.** GitHub doesn't expose an API to mint its own PATs.
  See "Ephemeral admin PAT" below — the operator creates a high-scope
  PAT just for the duration of `rando vc setup` and revokes it
  immediately after. The long-lived bootstrap PAT (used by every other
  workflow) stays minimal-scope.
- **2FA enrollment.** User-level action only.
- **Repo creation** itself (could automate via `POST /user/repos` or `POST
/orgs/{org}/repos`, but the first run is so tied to org/team policy that
  manual is fine).
- **Required reviewer accounts.** Need to exist as GH users first; the
  API references them by login but can't create them.

### Ephemeral admin PAT — credential lifecycle

`rando vc setup` needs admin-grade scopes (`administration:write`,
`secrets:write`, `actions:write`, `environments:write`, ruleset writes).
Granting those scopes to the long-lived bootstrap PAT means every
unrelated workflow run inherits them too — a leak of any single
workflow's token equals full repo control.

Solution: the admin PAT is **ephemeral**, scoped to a single setup run:

1. **Pre-run.** Operator generates a fine-grained PAT in GH UI with the
   admin scope set. (PAT minting itself stays manual — GH gives no API
   for it.) Names it predictably: `rando-vc-setup-YYYYMMDD-HHMMSS`.
2. **Run.** Operator pipes it in: `rando vc setup --admin-token "$ADMIN_PAT"`.
   Token is held only in process memory; never written to disk, never
   logged, never committed. The command runs idempotently against all
   P0 endpoints.
3. **Post-run.** `rando vc setup` calls `DELETE /personal-access-tokens/{id}`
   on itself as its last step, revoking its own token. If the run fails
   mid-flight, the operator deletes the PAT manually (and a `rando setup
gh --revoke-token` subcommand exists as a fallback).
4. **Audit.** GH's PAT-creation log captures the create + revoke pair.
   The window the elevated token exists is bounded by the wall-clock of
   one `rando vc setup` run (~30 API calls, seconds).

What this BUYS us:

- The long-lived `OP_SERVICE_ACCOUNT_TOKEN` / GH workflow PATs need
  only read-scopes for normal operation. A leak of one of those
  doesn't let an attacker reconfigure the ruleset, rotate reviewers,
  or rewrite secrets.
- Setup runs leave a positive audit trail (PAT created, used, revoked
  — easy to reconcile against the operator's intent).
- New apps following [[process-reusable-template]] adopt the same
  pattern — fresh ephemeral PAT per new repo, never persisted.

What this DOES NOT buy:

- Protection against compromise of the admin PAT DURING the setup
  window. Mitigation: short window + don't run setup on shared dev
  boxes. Worst case is ~30 seconds of elevated access.
- Full automation of PAT creation. GH could change this later; until
  then, the manual step is unavoidable. We make it small.

GitHub App alternative (deferred): a GitHub App installation token
has built-in expiry (1 hour) and finer-grained permissions, but
requires creating + maintaining an App in the org. Worth revisiting
if we ever have > 3 repos to manage.

## Command surface

`rando vc setup` becomes the umbrella; subcommands handle the slices:

```
rando vc setup --admin-token "$PAT" --dry-run   # full report: what'd change
rando vc setup --admin-token "$PAT"             # apply everything (then revoke PAT)
rando vc ruleset --admin-token "$PAT"     # just the ruleset
rando vc environments --admin-token "$PAT"
rando vc secret --admin-token "$PAT"     # calls into [[security-secrets-strategy]]
rando vc labels --admin-token "$PAT"
rando vc repo-settings --admin-token "$PAT"
rando vc codeowners                       # local file, no token needed
rando vc revoke-token "$PAT"            # cleanup-only after a partial failure
```

The token is required for every subcommand that hits an admin endpoint
(everything except `codeowners`, which is a local file write). Reading
from the process env (`RANDO_ADMIN_TOKEN=$PAT rando vc setup`) works too
— the flag is for explicit one-shot runs.

Each subcommand is idempotent: read state, diff against desired, apply
delta. `--dry-run` shows the diff without applying.

### Configuration source

The "desired state" is a function of:

- `rando.config.json` for repo identity, environment names, deploy flow
- `.github/labeler.yml` for the label set ([[ci-pr-issue-labeler]])
- A new file `.github/CODEOWNERS` or generated from `rando.config.json` apps + maintainers list
- A new file `.github/rulesets/<name>.json` (or in `rando.config.json`) for ruleset definition
- `.env.example` files for the env-var set (via [[process-env-management]] integration)

Single declarative source: edit the file, run `rando vc setup`, state
converges. No UI clicks required.

## Phased delivery

**Phase 1 (lands first, immediate ROI)**

1. P0 endpoint adapters in `gh-cli.ts` (ruleset, environment, secret, repo settings)
2. `rando vc ruleset` + `rando vc repo-settings`
3. Smoke test against `iamnewton/rando` (the existing repo — operates idempotently, no change if state matches)

**Phase 2 (after [[security-secrets-strategy]] decision)**

4. `rando vc secret` — implements the Option B sync path
5. `rando vc environments` — includes reviewer setup
6. `rando vc labels` — provisions the label set

**Phase 3 (alongside [[process-reusable-template]])**

7. `rando vc codeowners` — generates from config + maintainers
8. `rando init <app>` calls `rando vc setup` as final step
9. CODEOWNERS auto-refresh on `rando.config.json` change

## Touch points

1. `packages/cli/src/adapters/gh.ts` (new — split from `gh-cli.ts`) —
   REST-API based for endpoints that don't need shell-out
2. `packages/cli/src/domain/gh-admin.ts` — interface (registered in `Adapters` factory as `ghAdmin(opts)`) covering the P0 set
3. `packages/cli/src/commands/version-control.ts` (new) — command + subcommands
4. `packages/cli/src/orchestrate.ts` — call `vc setup` in `rando infra
setup` after the Vercel/Cloudflare/Neon steps
5. `.github/CODEOWNERS` (new file once generator lands)
6. `.github/rulesets/main.json` (new — declarative ruleset)
7. `MAINTAINING.md` — "Setting up a new repo" section condenses to
   `rando vc setup` + a few one-time manual prereqs (PAT, 1P token)

## What we accept

- **GH API rate limits.** Authenticated PATs get 5000 req/hr;
  `rando vc setup` makes ~30 calls per full run — comfortably under
  the limit. No batching needed.
- **libsodium for secret encryption.** Repo + environment secrets must
  be encrypted client-side before push. Pulls in `tweetsodium` or
  `libsodium-wrappers` as a dep. Small, but adds CLI bundle size.
- **GH API surface area.** Each capability is a separate API endpoint;
  if GitHub adds new repo settings, we're behind. Mitigation: P2
  read-existing-and-diff capability surfaces unexpected state.

## What would make us reconsider

- **Terraform / Pulumi provider for GH.** Both have well-maintained
  modules covering all of P0. Trade-off: external dep, separate state
  file, separate tool to learn. We already have an adapter pattern;
  rando-native keeps the workflow consistent. Reconsider if the
  matrix of repos grows past ~5.
- **GitHub Actions starter workflows** introduce a way to declaratively
  configure rulesets / environments via repo files. If they do, the
  adapter layer thins.

## Refs

- #222 — original `rando vc setup` issue
- [[process-deploy-strategy]] D4 — needs environment + reviewers
- [[security-secrets-strategy]] — secret-push integration point
- [[ci-pr-issue-labeler]] — needs label-set provisioning
- [[security-github-baseline]] — gap inventory this resolves
- [[process-reusable-template]] — calls `rando vc setup` from `rando init`
