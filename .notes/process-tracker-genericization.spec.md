---
status: draft
issue: TBD
---

# Genericize Jira references → tracker-agnostic naming

## Why

The CLI already supports multiple issue trackers via the adapter
pattern:

- `packages/cli/src/adapters/jira-cloud.ts`
- `packages/cli/src/adapters/github-issues.ts`
- Domain interface: `packages/cli/src/domain/tracker.ts`

But Jira-specific naming leaked into shared surfaces:

```
$ grep -rln "JIRA\|jira" --include="*.ts" --include="*.json" \
    | grep -v node_modules | grep -v jira-cloud
rando.config.json
.notes/tech-feature-flags.spec.md
.notes/tech-api-testing-adapter.spec.md
packages/cli/src/doctor/checks/env.ts
packages/cli/src/doctor/checks/config.ts
packages/cli/src/setup-config.ts
packages/cli/src/git.ts
packages/cli/src/__tests__/*.test.ts
packages/cli/README.md
```

A new contributor reading the code would think Rando assumes Jira.
A new app forking this template would inherit the assumption. The
right shape: Jira is one adapter; everything else uses
tracker-agnostic naming.

## Decision

Rename across three layers:

### 1. Environment variables

| Current                                         | New                                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `RANDO_JIRA_*` (if any exist)                   | `RANDO_ISSUE_TRACKER_*`                                                                                                                      |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | Stay (these are vendor-side env vars, named by the vendor; the CLI's job is to mark them as "only relevant when `tracker.kind === 'jira'`"). |

### 2. Code symbols

| Current                               | New                         |
| ------------------------------------- | --------------------------- |
| `JiraKey`                             | `IssueKey`                  |
| `getJiraKey()`                        | `getIssueKey()`             |
| `cachedJiraKey`                       | `cachedIssueKey`            |
| `branch.<name>.jira-key` (git config) | `branch.<name>.tracker-key` |

The pre-commit hook's git-config key (`branch.<name>.jira-key`) is
the most user-visible — it's what the picker writes to cache the
choice. Renaming requires:

- `rando issues pick --migrate-cache` one-off that walks
  `git config --get-regexp branch\..*\.jira-key` and rewrites to
  `tracker-key`.
- OR a fallback in the hook that reads both keys for a deprecation
  window (~1 month) before removing the old read.

### 3. Documentation

`.notes/*.spec.md` and README content:

- "Jira tickets" → "tracker tickets" or "issue tracker tickets"
- "Jira key" → "issue key"
- Keep "Jira" in vendor-specific contexts (adapter docs, "if you
  use Jira, …")

### What stays Jira-named (intentional)

- `packages/cli/src/adapters/jira-cloud.ts` — vendor adapter, by name
- `tracker.kind: 'jira'` in `rando.config.json` — the value IS the
  vendor name; that's the point
- `JIRA_BASE_URL`/`JIRA_EMAIL`/`JIRA_API_TOKEN` env vars — these are
  Jira's vendor-side names; renaming would be misleading

## Touch points

1. `rando.config.json` — verify the config field is `tracker.kind`
   (already), not `jira.*` (sweep)
2. `packages/cli/src/git.ts` — rename `getJiraKey` → `getIssueKey`,
   git-config key migration helper
3. `packages/cli/src/setup-config.ts` — rename any `JIRA_*` config
   field names that aren't vendor-specific
4. `packages/cli/src/doctor/checks/{env,config}.ts` — update doctor
   checks to use neutral names; vendor-specific env var checks gated
   on `tracker.kind === 'jira'`
5. `packages/cli/src/__tests__/*.test.ts` — symbol renames
6. `packages/cli/README.md` — sweep "Jira" → "issue tracker" where
   generic
7. `.notes/tech-feature-flags.spec.md` — sweep
8. `.notes/tech-api-testing-adapter.spec.md` — sweep
9. `.husky/pre-commit` — git-config key migration (probably reads
   `branch.<name>.tracker-key` with `jira-key` fallback for a
   deprecation window)

## Compatibility

The git-config cache key (`branch.<name>.jira-key`) is the
load-bearing rename — humans have these set locally and CI uses
them via the pre-commit hook.

Two-phase rename:

**Phase 1**: pre-commit hook reads BOTH `tracker-key` and `jira-key`
(prefers `tracker-key`). New writes go to `tracker-key`. Document
this in CONTRIBUTING.md.

**Phase 2** (after ~1 month): drop the `jira-key` fallback. By that
point, regular workflow has migrated everyone via re-pick.

## What we accept

- **One-time migration friction**. Maintainers re-pick their issue
  on first commit after Phase 1 lands; the new key is written, old
  key stays until next `git gc` or manual cleanup.
- **`rando.config.json`'s `tracker.kind: 'jira'`** keeps the Jira
  name — by design. Vendor identity is fine inside the config; it's
  the generic shared surfaces that need renaming.

## What would make us reconsider

- **A third tracker adapter lands** (e.g. Linear, Asana). At that
  point this rename was correct, and the same shape extends. No
  spec change needed.
- **The git-config migration breaks for a contributor**. If the
  fallback isn't enough, extend Phase 1's deprecation window or add
  a `rando issues pick --migrate-cache` one-off.

## Refs

- `packages/cli/src/domain/tracker.ts` — existing tracker interface
  (already neutral; spec ensures naming follows)
- `tool-pr-review-bot.spec.md` — adjacent automation that might
  consume tracker keys
