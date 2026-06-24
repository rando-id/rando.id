---
status: proposed # draft → proposed (issue filed) → approved (milestone attached)
issue: 210
---

# Deploy strategy — staging auto, previews opt-in, prod gated

## Why this exists

Today, four things fire Vercel deployments at Rando:

1. **Vercel's native GitHub integration** auto-deploys every push to
   every branch / every PR — three projects (api, web, admin), so
   ~3 deployments per push regardless of what changed. Counts toward
   the 100/day Hobby quota even when `turbo-ignore` skips the build.
   ([[project-rando-vercel-quota]])
2. **Our `deploy.yml`** fires PR previews via `rando deploy branch`,
   gated by `DEPLOY_PREVIEW_ENABLED`, author (Dependabot opt-in by
   label), and per-app affected detection ([[ci-per-app-preview-gating]]).
3. **Vercel native push trigger on `main`** is what currently deploys
   production. No human gate.
4. **Vercel native push trigger on `staging`** is what deploys staging
   (kept in sync by `sync-staging.yml`).

The quota incident on PR #187 (2026-06-23) made it concrete: even with
our gating working correctly, Vercel native fires independently and we
ran out of preview budget mid-day. **Goal: reduce Vercel deploys to
only the cases we explicitly opt into, and gate prod on a human.**

The downstream blocker this unlocks: ~70 open Dependabot PRs are
currently un-triageable because every rebase burns 3 native preview
deploys against the daily cap. Opt-in previews make the backlog
approachable. ([[ci-dependabot-triage]])

## The four policies

| #   | Branch / event    | Today                                  | Target                                                                      |
| --- | ----------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Push to `staging` | Vercel native auto-deploys             | Our workflow auto-deploys (Vercel native off)                               |
| 2   | PR open / sync    | Vercel native + our workflow both fire | Our workflow only, **opt-in via `deploy-preview` label** for _every_ author |
| 3   | Push to `main`    | Vercel native auto-deploys to prod     | **No auto-deploy.** Prod requires explicit human action                     |
| 4   | Any other push    | Vercel native fires                    | Nothing fires                                                               |

The unifying pattern: **Vercel native PR previews + push deploys are
turned off across all three projects (api, web, admin); every deploy
that happens runs through our `deploy.yml` via `rando deploy …`.**
Single source of truth, gated however we want at the workflow level.

## Decisions

### D1. Disable Vercel native deploys entirely (#204 → Option A)

For each of `rando-api`, `rando-web`, `rando-admin` in the Vercel
dashboard: **Settings → Git → uncheck "Automatic Preview Deployments"
AND uncheck "Production Deployments"**. After this, Vercel deploys
nothing on push — only what `rando deploy …` (via Vercel REST API)
asks it to.

This is a **manual one-time op**, not code. Documented as a
checklist in `.github/MAINTAINING.md` → "Initial Vercel setup" so a
fresh project setup gets it right. Tracked as the resolution to #204.

### D2. Staging auto-deploys via our workflow

Add a `push: branches: [staging]` trigger to `deploy.yml` (or a new
sibling `deploy-staging.yml` — see "Workflow layout" below) that
runs `rando deploy <env=staging>`. `sync-staging.yml` already
fast-forwards staging from main on every push, so this means: merge
to main → staging fast-forwards → our workflow deploys to the
staging Vercel environment.

**Requires:** `rando deploy` to support a non-branch, non-preview
mode targeting a specific Vercel environment. Today only
`rando deploy branch` and `rando deploy teardown` exist; we'd add
`rando deploy env <staging|production>`. Implementation lives in
`packages/cli/src/commands/deploy.ts` next to `branchDeploy`.

### D3. Feature-branch previews are opt-in for **every** author

Today, the gate is:

```yaml
github.actor != 'dependabot[bot]'
|| contains(labels, 'deploy-preview')
```

Flip to:

```yaml
contains(labels, 'deploy-preview')
```

Every PR — human or bot — needs the `deploy-preview` label for the
preview job to fire. The label is cheap to add (one click) and the
quota savings are large (the ~70 open Dependabot PRs immediately
stop burning deploys on rebase, plus draft-PR / WIP-PR previews
also stop firing unless the author asks for them).

**What contributors give up:** previews are no longer automatic on
PR open. Mitigation: `.github/CONTRIBUTING.md` documents the label;
the PR template includes a checkbox / reminder ("☐ Add
`deploy-preview` label if you want a Vercel preview"). For new
contributors, code review can apply the label on first touch.

### D4. Production deploys require explicit human action

Remove the `push: branches: [main]` trigger from any prod-deploying
path (Vercel native already covered by D1). The prod-deploy entry
points become:

- **`workflow_dispatch`** with required input `ref` (commit SHA) —
  the merger (or an oncall) goes to Actions → Deploy production →
  Run workflow, picks the commit, and confirms.
- **GitHub Environment "production"** with **required reviewers**
  = the repo's CODEOWNERS. The workflow_dispatch run pauses for
  approval before the `rando deploy env production` step.

The environment gate matters because `workflow_dispatch` alone can
be triggered by anyone with write access — adding a required
reviewer means a second pair of eyes (or at minimum a deliberate
"yes deploy this" click from the same person who triggered it).

**Optional follow-up (not in this spec):** a "main moved but no
prod deploy in N hours" reminder via the issue tracker or Slack.
File separately if it becomes a real friction.

## Workflow layout

Two reasonable shapes:

**Option L1: One `deploy.yml` handling all three modes.** A single
workflow with multiple jobs: `branch-deploy` (PR), `staging`
(push), `production` (workflow_dispatch). All share `op-env`,
`setup`, and the `rando` CLI bootstrap.

**Option L2: Three workflows.** `deploy-preview.yml`,
`deploy-staging.yml`, `deploy-production.yml`. Each is small and
self-explanatory; jobs don't share `concurrency:` groups so a
staging push and a PR preview can run in parallel without one
serializing the other.

**Pick L2.** Different triggers + different approval models +
different concurrency semantics — splitting per-environment is
cleaner. `deploy.yml` becomes `deploy-preview.yml` (rename +
unchanged behavior beyond D3); two new files for staging and prod.
The `concurrency: deploy-${PR_NUMBER}` group stays on preview;
staging gets `concurrency: deploy-staging`; prod gets
`concurrency: deploy-production` with `cancel-in-progress: false`
(in-flight prod deploy must complete).

## CLI additions

`rando deploy env <staging|production>` — deploys the current
checkout to the named Vercel environment. Internally calls the
same Vercel API surface as `rando deploy branch` but with
`target=production` (or the staging-equivalent project setting),
no stable-URL setup, no Cloudflare CNAME — environment deploys
own their own domain config in Vercel project settings.

Adapter pattern stays: deploy logic in `packages/cli/src/adapters/vercel.ts`,
domain interface in `packages/cli/src/domain/deploy.ts` if not
already; command in `packages/cli/src/commands/deploy.ts`.

## What we accept

- **Previews are now opt-in for humans too.** The most likely
  friction is "I forgot to add the label and now the PR has no
  preview" — solvable by adding the label and pushing an empty
  commit (or re-running the workflow). The PR template reminder
  handles new contributors; for solo-Newton flow this is
  ~zero-cost.
- **Prod deploys require remembering.** "Merged to main but didn't
  hit the deploy button" is a real failure mode. Accepted because
  the alternative (auto-deploy on main) was the explicit goal to
  remove. If it becomes friction → add the reminder follow-up
  above.
- **Vercel native is a manual checklist item.** Each new Vercel
  project added in the future has to disable native deploys in
  the dashboard. Documented in MAINTAINING.md to mitigate. If
  this becomes a frequent pattern, look into Vercel's project-
  config-as-code (vercel.json `git.deploymentEnabled` block).
- **Single CLI failure = no deploy.** With Vercel native off,
  `rando deploy` outages mean nothing deploys at all. Acceptable
  since `rando deploy` is just a thin wrapper around the Vercel
  REST API — if Vercel is up, we can deploy.

## Options considered

- **Keep Vercel native, just disable PR previews.** Half-measure —
  prod still uncontrolled. Skip.
- **Keep auto-deploy on main, gate via Vercel's "Deployment
  Protection".** Adds a manual approval in Vercel's UI per
  deploy. Works but the approval lives outside our repo's
  permission model — GitHub Environments give us reviewers
  scoped to our org.
- **Use `release: published` events instead of
  `workflow_dispatch`.** Tag-driven prod. Cleaner audit trail but
  requires a release-tagging workflow we don't have yet. File as
  a future evolution; ship workflow_dispatch first.
- **Auto-deploy preview on label add (not on push).** Already what
  GitHub does — the workflow re-evaluates `if:` on every PR
  event including `labeled`. No code needed.

## Sequencing for today

The four changes can land independently with feature flags
gating the cutover. Recommended order:

1. **D1 (Vercel dashboard flip)** — instant, no PR. Reversible by
   re-checking the boxes if anything goes wrong. Do this first
   so steps 2-4 are working in the target state.
2. **D2 (staging auto-deploy via workflow)** — needs
   `rando deploy env staging` CLI work + new workflow file.
   Highest-risk change; do early so the day's testing exercises
   it.
3. **D4 (prod gate)** — workflow file + Environment protection
   rule. Lowest risk since the failure mode is "deploy doesn't
   happen" not "wrong deploy happens." Can land before or after
   D2.
4. **D3 (label-opt-in flip)** — one-line change in
   `deploy-preview.yml`. Land last so D1-D2 are validated before
   we change the preview semantics. PR template update bundled.

Each gets its own PR for clean reviewability. Tracking issue
this spec proposes is the umbrella; the four PRs reference it
via `Refs #<umbrella>`.

## What would make us reconsider

- **The label-opt-in friction is real for solo flow.** If Newton
  hits "I keep forgetting the label" three times in a week,
  invert: human-authored PRs default to deploying, label
  becomes `no-deploy-preview`. Trade-off is back to ~1
  deploy per human-authored push — fine if Dependabot is
  rate-limited separately.
- **Vercel deprecates the REST API path we use.** Then we either
  pin to a versioned API, switch to their CLI (`vercel deploy
--target=production`), or pick a different provider entirely.
  Adapter pattern means the switch is local to
  `adapters/vercel.ts`.
- **GitHub Environment reviewers don't compose well with the
  CODEOWNERS file we don't have yet.** Fall back to
  `workflow_dispatch` alone + a Slack reminder on missing prod
  deploys.

## Touch points

1. **Vercel dashboard** (manual): disable Automatic Preview
   Deployments AND Production Deployments for `rando-api`,
   `rando-web`, `rando-admin`. Add checklist to
   `.github/MAINTAINING.md` → "Initial Vercel setup".
2. **`.github/workflows/deploy.yml` → rename to
   `deploy-preview.yml`** — flip the Dependabot-only label gate
   to all-authors label gate (D3). Otherwise unchanged.
3. **`.github/workflows/deploy-staging.yml`** (new) — push
   trigger on `staging`, runs `rando deploy env staging`.
4. **`.github/workflows/deploy-production.yml`** (new) —
   `workflow_dispatch` only, references GitHub Environment
   `production` with required reviewers. Runs `rando deploy env
production`.
5. **GitHub Environment "production"** (new, repo settings):
   required reviewers, no other restrictions.
6. **`packages/cli/src/commands/deploy.ts`** — new `env`
   subcommand. Tests in `__tests__/deploy.test.ts`.
7. **`packages/cli/src/adapters/vercel.ts`** — if the existing
   adapter doesn't already cover environment-target deploys,
   add the method.
8. **`.github/CONTRIBUTING.md`** — document the
   `deploy-preview` label is now required for previews on
   _all_ PRs.
9. **`.github/PULL_REQUEST_TEMPLATE.md`** (create if not
   present) — checkbox reminder for the `deploy-preview`
   label.
10. **`.github/MAINTAINING.md`** — "Deploy strategy" section
    rewritten to describe the new four-mode shape; Vercel
    dashboard checklist; prod-deploy SOP (Actions → Deploy
    production → Run workflow → enter SHA → approve).

Closes #204 once D1 + D2 + D3 + D4 land. (D1 alone resolves
the original #204 scope; D2-D4 are the broader strategy this
spec adds.)

Related: [[project-rando-vercel-quota]] (the quota memory
that frames the why), [[ci-per-app-preview-gating]] (the
gating mechanic the new preview workflow inherits),
[[ci-preview-quota-strategy]] (the original Dependabot
opt-in pattern this generalizes), [[ci-staging-auto-sync]]
(the staging branch sync this strategy now leans on),
[[ci-branch-slug-composite]] (the URL formatting fix that
becomes more visible once Vercel native isn't masking it).
