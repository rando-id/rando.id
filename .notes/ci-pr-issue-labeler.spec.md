---
status: draft
issue: TBD
---

# Auto-label PRs + issues based on paths and content

## Why

Today's labels are mostly hand-applied:

- `deploy-preview` — required for previews (per #216)
- `area:db`, `area:ci`, etc. — manual
- `dependencies`, `javascript` — Dependabot auto-applies these

Manual labeling skips often. Auto-labeling by file paths (PRs) and
template-section content (issues) keeps the labels accurate without
operator overhead, and makes search / filtering reliable.

## Decision

Two `actions/labeler@v6` workflows, one config file:

### PR labeler

`actions/labeler@v6` triggered on `pull_request_target` events.
Reads `.github/labeler.yml` for path → label mappings.

```yaml
# .github/labeler.yml
area:db:
  - changed-files:
      - any-glob-to-any-file: ['packages/db/**', 'apps/api/src/db/**']
area:cli:
  - changed-files:
      - any-glob-to-any-file: 'packages/cli/**'
area:ci:
  - changed-files:
      - any-glob-to-any-file: ['.github/workflows/**', '.github/actions/**']
area:auth:
  - changed-files:
      - any-glob-to-any-file: ['packages/auth/**', '**/middleware.ts']
area:ui:
  - changed-files:
      - any-glob-to-any-file: 'packages/ui/**'
area:docs:
  - changed-files:
      - any-glob-to-any-file:
          ['**/*.md', '.notes/**', '.github/CONTRIBUTING.md', '.github/MAINTAINING.md']
app:api:
  - changed-files:
      - any-glob-to-any-file: 'apps/api/**'
app:web:
  - changed-files:
      - any-glob-to-any-file: 'apps/web/**'
app:admin:
  - changed-files:
      - any-glob-to-any-file: 'apps/admin/**'
app:native:
  - changed-files:
      - any-glob-to-any-file: 'apps/native/**'
type:spec:
  - changed-files:
      - any-glob-to-any-file: '.notes/**/*.spec.md'
```

A PR touching `packages/db/` + `apps/api/` gets `area:db`, `app:api`
auto-applied on open / sync.

### Issue labeler

`github/issue-labeler@v3` reads `.github/issue-labeler.yml`. The
existing issue templates (`bug_report.yml`, `feature_request.yml`)
already have an "Area" dropdown that maps to labels — extend or
replace this with content-based regex:

```yaml
# .github/issue-labeler.yml
area:db:
  - '/packages\/db/i'
  - '/database|postgres|drizzle/i'
area:auth:
  - '/clerk|auth|sign[-]?in/i'
area:cli:
  - '/`rando .*`/'
  - '/packages\/cli/i'
```

## Touch points

1. `.github/workflows/labeler.yml` (new) — runs `actions/labeler@v6`
   on `pull_request_target` opened / synchronize.
2. `.github/workflows/issue-labeler.yml` (new) — runs
   `github/issue-labeler@v3` on `issues` opened / edited.
3. `.github/labeler.yml` (new) — PR path→label config.
4. `.github/issue-labeler.yml` (new) — issue content→label config.
5. `.github/ISSUE_TEMPLATE/bug_report.yml` + `feature_request.yml`
   — keep the Area dropdown for explicit override; auto-labeler
   adds on top.
6. `MAINTAINING.md` — short section under "Issues" + "Pull requests"
   documenting the convention + which labels exist.

## Label set (initial)

| Prefix           | Examples                                                              | Meaning                                  |
| ---------------- | --------------------------------------------------------------------- | ---------------------------------------- |
| `area:`          | `area:db`, `area:cli`, `area:ci`, `area:auth`, `area:ui`, `area:docs` | What subsystem                           |
| `app:`           | `app:api`, `app:web`, `app:admin`, `app:native`                       | Which app workspace                      |
| `type:`          | `type:spec`, `type:bug`, `type:feat`                                  | What kind of work                        |
| `deploy-preview` | (unique)                                                              | Opts the PR into preview deploy (manual) |
| `dependencies`   | (Dependabot)                                                          | Auto-applied by Dependabot               |

Labels should exist in the repo before the action runs (it doesn't
auto-create). `rando setup gh` (#222) should provision them.

## What we accept

- **Label sprawl risk**. Start with the ~15 labels above; resist
  adding new ones unless they map to a filter you'll actually use.
- **`pull_request_target` security**. The labeler action runs with
  write permission against the PR. Use `pull_request_target` (not
  `pull_request`) since `pull_request` from forks has read-only
  token; the labeler needs write. Pin action by SHA + audit per
  the security-baseline gaps.

## What would make us reconsider

- **Auto-labels become noise** (e.g. every PR gets 6 labels and
  filters become useless). At that point, narrow the config to
  fewer high-signal labels.
- **Manual override happens often** — if reviewers regularly
  remove the auto-labels, the rules are wrong; tune the globs.

## Refs

- `security-github-baseline.md` — gap #5 (no labeler today)
- #222 — `rando setup gh` should provision the label set
- `tool-pr-review-bot.spec.md` — adjacent automation surface
