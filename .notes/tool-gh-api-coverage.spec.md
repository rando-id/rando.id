---
status: draft
issue: TBD
---

# All GitHub infra via API — `rando setup gh` coverage map

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

`rando setup gh` was filed as #222 to fix this. This spec is the surface
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

- **Initial PAT creation.** GitHub doesn't expose an API to mint its own
  PATs; the operator generates the bootstrap PAT once, stores it in
  `OP_SERVICE_ACCOUNT_TOKEN`, and `rando setup gh` uses it for everything else.
- **2FA enrollment.** User-level action only.
- **Repo creation** itself (could automate via `POST /user/repos` or `POST
/orgs/{org}/repos`, but the first run is so tied to org/team policy that
  manual is fine).
- **Required reviewer accounts.** Need to exist as GH users first; the
  API references them by login but can't create them.

## Command surface

`rando setup gh` becomes the umbrella; subcommands handle the slices:

```
rando setup gh --dry-run            # full report: what'd change
rando setup gh                      # apply everything
rando setup gh ruleset              # just the ruleset
rando setup gh environments         # environments + reviewers
rando setup gh secrets              # secret push (calls into [[security-secrets-strategy]])
rando setup gh labels               # label set provisioning
rando setup gh repo-settings        # squash/auto-merge/etc.
rando setup gh codeowners           # generate/refresh CODEOWNERS
```

Each subcommand is idempotent: read state, diff against desired, apply
delta. `--dry-run` shows the diff without applying.

### Configuration source

The "desired state" is a function of:

- `rando.config.json` for repo identity, environment names, deploy flow
- `.github/labeler.yml` for the label set ([[ci-pr-issue-labeler]])
- A new file `.github/CODEOWNERS` or generated from `rando.config.json` apps + maintainers list
- A new file `.github/rulesets/<name>.json` (or in `rando.config.json`) for ruleset definition
- `.env.example` files for the env-var set (via [[process-env-management]] integration)

Single declarative source: edit the file, run `rando setup gh`, state
converges. No UI clicks required.

## Phased delivery

**Phase 1 (lands first, immediate ROI)**

1. P0 endpoint adapters in `gh-cli.ts` (ruleset, environment, secret, repo settings)
2. `rando setup gh ruleset` + `rando setup gh repo-settings`
3. Smoke test against `iamnewton/rando` (the existing repo — operates idempotently, no change if state matches)

**Phase 2 (after [[security-secrets-strategy]] decision)**

4. `rando setup gh secrets` — implements the Option B sync path
5. `rando setup gh environments` — includes reviewer setup
6. `rando setup gh labels` — provisions the label set

**Phase 3 (alongside [[process-reusable-template]])**

7. `rando setup gh codeowners` — generates from config + maintainers
8. `rando init <app>` calls `rando setup gh` as final step
9. CODEOWNERS auto-refresh on `rando.config.json` change

## Touch points

1. `packages/cli/src/adapters/gh.ts` (new — split from `gh-cli.ts`) —
   REST-API based for endpoints that don't need shell-out
2. `packages/cli/src/domain/gh.ts` — new interface covering the P0 set
3. `packages/cli/src/commands/setup/gh.ts` (new) — command + subcommands
4. `packages/cli/src/orchestrate.ts` — call `setup-gh` in `rando infra
setup` after the Vercel/Cloudflare/Neon steps
5. `.github/CODEOWNERS` (new file once generator lands)
6. `.github/rulesets/main.json` (new — declarative ruleset)
7. `MAINTAINING.md` — "Setting up a new repo" section condenses to
   `rando setup gh` + a few one-time manual prereqs (PAT, 1P token)

## What we accept

- **GH API rate limits.** Authenticated PATs get 5000 req/hr;
  `rando setup gh` makes ~30 calls per full run — comfortably under
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

- #222 — original `rando setup gh` issue
- [[process-deploy-strategy]] D4 — needs environment + reviewers
- [[security-secrets-strategy]] — secret-push integration point
- [[ci-pr-issue-labeler]] — needs label-set provisioning
- [[security-github-baseline]] — gap inventory this resolves
- [[process-reusable-template]] — calls `rando setup gh` from `rando init`
