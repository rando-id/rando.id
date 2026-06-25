---
status: proposed # draft → proposed (issue filed) → approved (milestone attached)
issue: 184
---

# Preview deploys: opt-in for Dependabot PRs

Vercel's free tier caps deployments at **100/day across the
account**. Each PR's `deploy.yml` run produces 3 preview deploys
(api + web + admin). With 70+ open Dependabot PRs rebasing
through the week + regular feature work, hitting the quota is
predictable — not exceptional — and was observed first on
PR #182 (Dependabot rebase + 3 apps × 3 commits = 9 deploys, on
top of feature work that same day, tripped the limit).

When the limit trips, `rando deploy branch` fails with
`payment_required, code: "api-deployments-free-per-day"`, the
preview never comes up, and downstream checks that depend on the
preview URL (notably `integration-tests.yml`'s Postman + spec-lint
runs) soft-skip with a misleading SUCCESS. Net effect: we can't
trust the CI rollup on PRs that hit the quota, and a dependency
bump can land without its real validation gate running.

## Decision

**Make preview deploys opt-in for Dependabot PRs via a
`deploy-preview` label.** Non-Dependabot PRs continue to
auto-deploy on every sync as today. A reviewer who wants to
see a preview for a given Dependabot bump adds the
`deploy-preview` label and the next sync (or a re-run) fires
the deploy.

Concretely, `branch-deploy`'s job-level `if:` becomes:

```yaml
if: ${{
  vars.DEPLOY_PREVIEW_ENABLED != 'false'
  && github.event.action != 'closed'
  && (
    github.actor != 'dependabot[bot]'
    || contains(github.event.pull_request.labels.*.name, 'deploy-preview')
  )
}}
```

`teardown` stays unconditional on close (same rationale as the
`paths-ignore` decision in [[ci-deploy-skip]]: closing must always
clean up infra even if the PR's last state was preview-less).

## Why opt-in (not "skip Dependabot entirely")

Some Dependabot bumps genuinely benefit from a preview:

- Tamagui / next / react majors with real UI changes
- Clerk major bumps that affect auth flows
- Major version jumps where unit tests can't tell the whole story

Hard-skipping Dependabot for ALL PRs would force a manual workaround
(comment-bot-rerun, force-push, etc.) every time. Label opt-in puts
the decision in the reviewer's hands at PR-review time, costs one
click, and the deploy fires on the next sync without rebuilding.

## Why label-based (not comment-based or workflow-dispatch)

- **Label.** Visible in the PR list, persistent across rebases,
  matches the existing `status:*` / `area:*` taxonomy. The
  reviewer adds it once; subsequent syncs see it and deploy.
- **Comment trigger.** `/preview` slash-command via a separate
  workflow. More flexible (per-deploy decisions) but adds a new
  workflow file + comment-parsing logic. YAGNI for now.
- **workflow_dispatch.** Manual fire from the Actions UI. No PR
  context — you'd have to copy the branch name. Awkward.

Label wins on simplicity + persistence.

## Options considered

- **Skip Dependabot previews entirely, no override.** Saves the
  most quota. Forces a workaround when a preview IS needed
  (force-push, close-and-reopen). Skip — the friction lands on
  the wrong side.
- **Skip on deps-only diffs (any author).** Compute `depsOnly`
  in `.github/actions/changes` (true when ONLY package.json +
  lockfile changed). Catches Dependabot AND any human bump-only
  PR. More principled, but covers ~95% of the same cases as
  "skip Dependabot" with more YAML. Defer — revisit if humans
  start opening bump-only PRs frequently.
- **Upgrade Vercel to Pro ($20/mo per member).** Buys headroom
  but doesn't fix the underlying "we deploy when we don't need
  to" problem. Still worth doing if engineering effort to avoid
  it exceeds the dollar cost. Not today.
- **Group multiple Dependabot PRs into one preview.** Theoretically
  saves the most quota but requires a custom batching workflow
  - the merge orchestration to manage which PRs share a preview.
    Massive overengineering for current scale.

## What we accept

- **Reviewer must remember to add the label** when a Dependabot
  bump merits a preview. Mitigation: MAINTAINING.md call-out +
  the Dependabot triage doc's "major bump candidates" list
  ([[ci-dependabot-triage]]) flags the categories that usually
  need previews (tamagui, next, react, clerk).
- **No preview = no Postman integration tests** for that PR's
  Dependabot bump. The Postman tests already require a reachable
  preview URL. We accept this trade-off because: (a) Dependabot
  bumps validate via unit tests + the nightly integration-tests
  run against staging, (b) when a bump merits Postman validation,
  the reviewer can add the label.
- **Bot-author detection is brittle.** GitHub identifies
  Dependabot as `dependabot[bot]`. If Dependabot's account ID
  ever changes, every PR falls through to "auto-deploy" (fail-
  open). Acceptable — fails toward "more deploys," not "missed
  deploys."

## What would make us reconsider

- **The label adds too much friction** — every Dependabot PR
  needs a preview anyway. In that case: upgrade Vercel to Pro
  and remove the label gate.
- **Humans start opening lots of deps-only PRs** — bypass the
  bot-author check by extending the gate to `depsOnly` from
  `.github/actions/changes`.
- **We outgrow Vercel** — moving to GitHub-driven deploys
  (Option 3 in MAINTAINING.md's deploy strategy) would collapse
  the quota issue but is much larger work.

## Touch points

1. `.github/workflows/deploy.yml` — add the `deploy-preview` label gate
   to `branch-deploy`'s `if:`. `teardown` unchanged.
2. **New label `deploy-preview`** (created via `gh label create`) with a
   description like "Force a preview deploy on a Dependabot PR".
3. `.github/MAINTAINING.md` → "Skipping deploys when no code
   changed" section: add subsection on the Dependabot opt-in.
4. `.github/CONTRIBUTING.md` — add a brief note: "If you're
   reviewing a Dependabot PR and want to see a preview, add the
   `deploy-preview` label."
5. `.github/PULL_REQUEST_TEMPLATE.md` — no change; humans aren't
   gated.

Related: [[ci-deploy-skip]], [[ci-dependabot-triage]]
