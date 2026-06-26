---
status: archived
issue: 194
closed: 2026-06-24
---

# Auto-sync staging from main on every push

Staging branch is a mirror of `main` — every push to `main`
should fast-forward staging to match. Manual sync got missed
multiple times in one session (PR #190 fix → an accidental
overwrite → re-sync; then #202 merge required another sync) —
the automation cost is one ~20-line workflow file.

## Decision

A new workflow `.github/workflows/sync-staging.yml` fires on
`push: branches: [main]` and runs `git push origin
HEAD:refs/heads/staging`. This is a **fast-forward push, NOT a
force push** — if staging has diverged (commits not on main),
the push fails and surfaces a clear error.

A `workflow_dispatch` trigger with a `force` boolean input
provides manual recovery for the divergence case, without
needing the operator to manually run git commands locally.

## Why fast-forward, not force

Auto-forcing would silently overwrite any staging-only work —
hotfix commits, release tags, etc. We don't have a hotfix-on-
staging workflow today, but a `--force` default would lock us
out of ever introducing one and would lose data if anyone ever
pushed to staging directly by mistake.

Fail-loud on divergence means an operator notices, looks at the
divergent commits, and decides: rebase them onto main → push to
main → auto-sync proceeds. The escape hatch (`workflow_dispatch`
with `force=true`) covers the case where the divergence is
known-stale and should be overwritten (this session's recovery
scenario, twice).

## Permissions

The workflow needs `contents: write` to push to staging.
GitHub's default `GITHUB_TOKEN` has this scope when granted via
the workflow's `permissions:` block. No PAT needed.

Important: branch protection rules on `staging` (if any) need to
allow pushes from GitHub Actions. As of writing there are no
protection rules on `staging` — branch is unprotected by design
(it's a deploy trigger, not a review target).

## Concurrency

`concurrency: group: sync-staging` (single group, no cancel) —
multiple back-to-back merges to main get serialized rather than
racing each other. A run from merge N+1 waits for merge N's run
to finish; no merges get skipped.

## What this workflow does NOT do

- **Doesn't run any other staging-deploy logic.** Vercel watches
  the staging branch independently — pushing to staging IS the
  deploy trigger; the workflow's job ends at the push.
- **Doesn't gate on tests/lint.** Main has already passed every
  required check before merge (per #193's merge-checks rule), so
  re-running them on the sync would just burn minutes for no
  signal.
- **Doesn't notify on success.** Successful syncs are the
  steady-state expectation; surfacing them is noise. Failure
  emits a workflow `::error::` and shows up in the Actions UI.

## Options considered

- **Schedule-based sync (cron every 30 min).** Misses the
  immediate gap after a merge. Skip — push-driven is strictly
  better.
- **`rando staging sync` CLI command + manual cadence.** Loses
  the "automatic" guarantee that motivated this work. Skip —
  but the CLI command is still worth building separately as
  the manual recovery path (see [[project_rando_cli_polish_backlog]]).
- **Vercel's native "branch follow" feature.** Vercel doesn't
  expose this for Git-watched branches. Skip.
- **GitHub's "Sync fork" feature.** Only works for fork
  relationships, not same-repo branches. Skip.

## What we accept

- **Staging-only commits get lost** the next time main is pushed
  to (unless someone disables the workflow or hot-pushes
  `--force` first). This is the design — Rando's staging model
  is "main with a different alias," NOT "stable release."
  Documented in MAINTAINING.md so future devs don't bake hotfix
  workflows around a staging branch that doesn't survive them.
- **Workflow failure on divergence is noisy.** If a dev
  accidentally pushes to staging directly, the next merge to
  main produces a red CI run on `Sync staging`. That's
  intentional — the alternative is silent data loss.
- **One more workflow file in the matrix.** Negligible.

## What would make us reconsider

- **A real release process appears.** If we ever cut staging
  releases independently of main (tagged staging versions,
  hotfix-on-staging-only flows), the fast-forward model breaks
  and we'd need a release-branch strategy instead.
- **Branch protection on `staging`.** If staging gains
  protection rules that block Actions pushes, the auth model
  needs to change (PAT with appropriate scope, or a deploy key,
  or a GitHub App). All workable, just not free.

## Touch points

1. `.github/workflows/sync-staging.yml` — the new workflow
2. `.github/MAINTAINING.md` — "Staging out of sync" recovery
   section that points operators at the `workflow_dispatch`
   force-sync path

Related: [[ci-vercel-protection-bypass]] (the session that
exposed the manual-sync gap), [[#190]] (the initial
staging-rotted fix), [[#202]] (the rename PR whose merge
triggered the second manual sync of this session).
