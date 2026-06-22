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
   the `branch-deploy` job on
   `steps.changes.outputs.code == 'true' || steps.changes.outputs.shared == 'true'`,
   reusing the existing `.github/actions/changes` composite. `code`
   covers TS/JS source + tsconfig + lockfile; `shared` covers
   `turbo.json` + root `package.json`. `branch-deploy` short-circuits
   with a notice when neither matches. The `teardown` job stays
   untouched — fires unconditionally on `event.action == 'closed'`.

2. **Prod / staging push deploys** (Vercel's native GitHub
   integration → `vercel build`) — each app's `vercel.json` sets
   `ignoreCommand: "npx -y turbo-ignore@<exact-version> @rando/<app>"`.
   Turbo walks the workspace dep graph and exits **0** when the app
   and its transitive deps haven't changed; Vercel's `ignoreCommand`
   contract is **exit 0 = skip the build**, exit 1 = proceed.
   Verified against `npx turbo-ignore --help` ("Only proceed with
   deployment if the workspace or any of its dependencies have
   changed") + a live run that printed `⏭ Ignoring the change` and
   exited 0. The pinned version must match the installed `turbo`
   version exactly so they share the same dep-graph schema; see
   "Bump policy" below.

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

## Why gate on `code || shared` (not on `docs`)

`dorny/paths-filter` outputs a filter true when **at least one
changed file matches** the pattern — NOT when every changed file
matches. So `outputs.docs == 'true'` means "this PR touched some
docs file"; it does NOT mean "this PR is docs-only". A PR with one
`.ts` change AND one `README.md` update has both `docs=true` AND
`code=true`. A `docs != 'true'` gate would incorrectly skip it.

Gating on the positive `code || shared` signal is consistent with
how `lint.yml`, `typecheck.yml`, and `codeql.yml` already work in
this repo:

- `code = true` — any TS/JS source / tsconfig / lockfile changed
- `shared = true` — any of `turbo.json` / root `package.json` /
  lockfile changed

Together they catch every deploy-worthy change pattern this repo
has today. A PR touching only docs / `.notes/**` / `LICENSE` has
both false and skips.

The misleading `docs:` description that originally seeded the bug
("Only docs / license / GitHub templates changed.") was corrected
in the same PR — see `.github/actions/changes/action.yml`.

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
- **Gate on the `docs` output as negative signal** (`docs != 'true'`
  to deploy). Looked tempting given the goal ("skip docs-only
  PRs") but semantically wrong — `dorny/paths-filter` outputs are
  ORed across changed files, so a mixed code+docs PR has `docs=true`
  and would be wrongly skipped. See "Why gate on code || shared"
  above. The misleading description on the `docs` output in
  `.github/actions/changes/action.yml` seeded this in the first
  draft of the PR; fixed in the same PR.
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
  signals conceptually (via `.github/actions/changes` for one side,
  via turbo's dep graph for the other) is the closest we can get.

## Why pin `turbo-ignore` in `npx`

`ignoreCommand` runs **before** Vercel runs `installCommand` — the
whole point of the step is to bail out before incurring install
cost. So `node_modules` isn't populated yet and we can't use
`pnpm exec turbo-ignore` (the standard lockfile-locked invocation
pattern). We're stuck with `npx`, which means each Vercel build
fetches the package fresh from the npm registry.

Without a version pin, `npx -y turbo-ignore` resolves to the
current `latest` tag at build time. That's a supply-chain
execution surface — a compromised release on the npm registry
would run arbitrary code in the Vercel build environment and
affect deploy outcomes. Pinning to an exact version (no caret, no
tilde, no tag) reduces the surface to "what we explicitly chose to
trust" — npx still fetches each build, but always fetches the
same artifact.

This doesn't eliminate the risk entirely (the npm registry could
in theory be compromised and serve a tampered tarball for the
pinned version — npm's own integrity checks mitigate but don't
fully prevent). The fully-mitigated alternatives are heavier:

- Vendor the script into the repo (not trivial — turbo-ignore is
  a TS project with its own dep tree).
- Run install before the gate via a custom Vercel build script
  (defeats the purpose of `ignoreCommand`).

Pinning is the practical answer.

## Bump policy for `turbo-ignore`

The pinned version in each `vercel.json` MUST match the installed
`turbo` version in the lockfile (`pnpm-lock.yaml`). turbo and
turbo-ignore ship lockstep from the same Vercel/turborepo
monorepo and share the same dep-graph schema — a version skew
risks turbo-ignore misreading what's affected.

To bump:

1. Bump `turbo` in the root `package.json` and run `pnpm install`
   to update the lockfile.
2. Note the resolved `turbo` version in the lockfile (e.g.
   `turbo@2.9.16`).
3. Replace `turbo-ignore@<old>` with `turbo-ignore@<new>` in all
   three `apps/*/vercel.json` files (currently api, web, admin).
4. Open the PR with both changes in the same commit so they stay
   in lockstep.

Dependabot doesn't auto-cover this because the `vercel.json` files
aren't a manifest format it understands. The bump must be manual
when `turbo` itself is bumped.

## What we accept

- **Two seams must stay aligned.** Widening one (adding patterns to
  `code:` / `shared:` in `.github/actions/changes/action.yml`)
  without the other can produce a PR preview that skips while prod
  deploy fires, or vice versa. Documented in MAINTAINING.md →
  Deploy strategy.
- **Setup overhead on docs-only PRs.** `branch-deploy` still does a
  checkout + `setup` + `changes` detection before short-circuiting
  (~30s of CI time). Acceptable cost for the cleaner conditional
  structure vs. trying to gate the setup steps themselves.
- **Asset / vercel.json / env-template / workflow-YAML changes
  don't deploy alone.** None of those match `code` or `shared`
  patterns. A PR that ONLY updates `apps/web/public/logo.svg`,
  `apps/api/.env.example`, or `vercel.json` skips the preview
  deploy. Rare in practice; the user can manually re-trigger with
  `rando deploy branch` if needed. Catch-all "non-docs" detection
  would require either a dorny/paths-filter negation pattern (not
  cleanly supported) or a custom git-diff script. Both bigger than
  the trade-off warrants today.
- **App-local README updates still deploy that app via Vercel.**
  Turbo treats all files inside a workspace as inputs by default.
  A change to `apps/api/README.md` triggers `api`'s Vercel build
  (but NOT a PR preview, since `README.md` doesn't match `code`).
  Can add `inputs:` exclusions to `turbo.json` later if it bites.
- **deploy.yml is not a required status check today.** The job-level
  gate produces a "success" workflow result when there's no code
  change (the notice step runs; subsequent steps are skipped which
  counts as success). If we ever make this required, audit that the
  skipped steps still report success — they do today.

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
