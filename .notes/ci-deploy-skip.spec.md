---
status: proposed # draft → proposed (issue filed) → approved (milestone attached)
issue: 178
---

# Skip deploys for docs-only changes

Don't burn CI minutes (or Vercel build minutes) on PRs / pushes that
only touch documentation. Two non-overlapping deploy paths need
filtering and the filters can't share a mechanism.

## Decision

Use two complementary seams:

1. **PR preview deploys** (`.github/workflows/deploy.yml` →
   `rando deploy branch`) — gate the substantive deploy steps inside
   the `branch-deploy` job on `steps.changes.outputs.docs != 'true'`,
   reusing the existing `.github/actions/changes` composite.
   `branch-deploy` short-circuits with a notice on docs-only PRs.
   The `teardown` job stays untouched — fires unconditionally on
   `event.action == 'closed'`.

2. **Prod / staging push deploys** (Vercel's native GitHub
   integration → `vercel build`) — each app's `vercel.json` sets
   `ignoreCommand: "npx -y turbo-ignore @rando/<app>"`. Turbo walks
   the workspace dep graph and exits 1 (skip) when the app and its
   transitive deps haven't changed.

## Why two seams

The two deploy paths are architecturally separate and neither
mechanism crosses over:

- `rando deploy branch` runs in GitHub Actions and calls Vercel's
  REST API directly. Vercel sees an explicit deploy call from the
  CLI — it doesn't consult `vercel.json`'s `ignoreCommand`.
- Vercel's GitHub integration auto-deploys on push to `main` /
  `staging`. deploy.yml never fires for those events (it's
  `pull_request` only), so the workflow gate doesn't apply.

A single seam covers one path and leaves the other uncovered. Both
are needed.

## Why job-level gating (not `paths-ignore` at the trigger)

The naive version of this puts `paths-ignore` on the workflow `on:`
trigger:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
    paths-ignore:
      - '.notes/**'
      - '**/*.md'
```

But `paths-ignore` applies to **every** `pull_request` event type,
including `closed`. Failure mode: open a PR with code changes
(deploy fires) → force-push to remove the code, leaving docs-only
(no deploy, fine) → close the PR (`paths-ignore` matches docs-only
diff, workflow doesn't fire, **teardown never runs**) → Vercel
custom domains and Cloudflare CNAMEs are orphaned.

Job-level gating keeps the trigger broad and gates only the work
that _should_ skip on docs-only. Teardown's only condition stays
`event.action == 'closed'`, which always fires on close regardless
of the diff.

## Options considered

- **Single seam: `paths-ignore` at trigger level.** Simplest. Killed
  by the teardown bug above. Caught in review of an earlier rev of
  this PR.
- **Single seam: workflow gate only (no `vercel.json`).** Covers
  PR previews but lets every push to `main` / `staging` build all
  three apps. Wastes Vercel build minutes on docs-only merges.
- **Single seam: `vercel.json` only.** Covers prod / staging but
  every docs-only PR still spins up a full preview environment via
  `rando deploy branch`. Wastes Actions minutes and pollutes the
  PR's deploy URLs with empty diffs.
- **Vercel dashboard "Ignored Build Step" instead of `vercel.json`.**
  Same behavior, but config lives outside the repo. Violates the
  "Prefer automation" rule in CLAUDE.md — onboarding a new
  contributor or restoring from a project-loss event requires
  manually re-clicking through the Vercel UI for each app.
- **Custom `git diff` in `vercel.json.ignoreCommand`** (e.g.
  `git diff HEAD^ HEAD --quiet -- ':!**/*.md'`). Works but isn't
  monorepo-aware — a change in `packages/ui` wouldn't auto-trigger
  the `web` deploy that depends on it. `turbo-ignore` reads the
  workspace dep graph from `package.json` and gets that for free.
- **Centralize gating in a single composite action used by both
  seams.** Tempting but Vercel's `ignoreCommand` runs in a Vercel
  build container that doesn't have the repo's composite actions
  available the same way GitHub Actions does. Two seams that share
  a `docs` filter spec (via `.github/actions/changes` for one side,
  via turbo's dep graph for the other) is the closest we can get.

## What we accept

- **Two seams must stay aligned.** Widening one (adding patterns to
  the `docs:` filter in `.github/actions/changes/action.yml`) without
  the other can produce a PR preview that skips while prod deploy
  fires, or vice versa. Documented in MAINTAINING.md → Deploy
  strategy → "Skipping deploys for docs-only changes".
- **Setup overhead on docs-only PRs.** `branch-deploy` still does a
  checkout + `setup` + `changes` detection before short-circuiting
  (~30s of CI time). Acceptable cost for the cleaner conditional
  structure vs. trying to gate the setup steps themselves.
- **App-local README updates still deploy that app.** Turbo treats
  all files inside a workspace as inputs by default. A change to
  `apps/api/README.md` triggers `api`'s Vercel build. We can add
  `inputs:` exclusions to `turbo.json` later if it bites.
- **deploy.yml is not a required status check today.** The job-level
  gate produces a "success" workflow result when docs-only (the
  notice step runs; subsequent steps are skipped which counts as
  success). If we ever make this required, audit that the skipped
  steps still report success — they do today.

## What would make us reconsider

- **Migrating to Option 2 (hybrid) or Option 3 (fully GitHub-driven)
  in MAINTAINING.md's deploy strategy.** If prod / staging deploys
  move into Actions, the two seams collapse into one (workflow
  gate) and we delete the `vercel.json` ignoreCommand layer.
- **A real annoyance from app-local README deploys.** If reviewers
  start ignoring "deploy succeeded" notifications because they fire
  on README updates, configure `turbo.json` `inputs` to exclude
  `**/*.md` per workspace.
- **A second monorepo using these seams.** The current `docs:`
  patterns in `.github/actions/changes/action.yml` are repo-local.
  If we ever publish the composite for reuse, the patterns need to
  be inputs to the action.

Related: [[ci-hardening]], [[process-releases-strategy]]
