---
status: archived
issue: 188
closed: 2026-06-23
---

# Integration tests: smart-target staging-by-default, preview-when-applicable

`integration-tests.yml` currently targets the per-PR preview URL
unconditionally on every `pull_request` event, polls
`/v1/health` for up to 5 minutes, and soft-skips if the preview
never came up. With the upcoming Dependabot opt-in
([[ci-preview-quota-strategy]] / #184) and per-app preview gating
([[ci-per-app-preview-gating]] / #186), the preview will routinely
not exist for valid reasons — Dependabot PRs without the
`deploy-preview` label, PRs that don't affect the API workspace,
etc. — and the
5-minute poll burns Actions minutes for nothing.

Reviewer feedback on #185 flagged this directly: "70+ Dependabot
PRs syncing weekly × 5 minutes of polling = significant wasted
runner time."

## Decision

**Default the integration-tests target to `staging-api.rando-id.dev`;
switch to the preview URL only when the PR is expected to have one.**
"Expected" matches deploy.yml's gate post-#185:

```text
human-authored, OR (Dependabot AND has 'deploy-preview' label)
```

Combined with the existing "skip when API workspace not affected"
gate, the matrix becomes:

| PR shape                                             | Action            | Target  | `mode` output      |
| ---------------------------------------------------- | ----------------- | ------- | ------------------ |
| API not affected                                     | skip              | n/a     | n/a                |
| API affected, `DEPLOY_PREVIEW_ENABLED=false`         | run (kill-switch) | staging | `staging-disabled` |
| API affected, human-authored                         | run               | preview | `preview`          |
| API affected, Dependabot, no `deploy-preview` label  | run (smoke test)  | staging | `staging`          |
| API affected, Dependabot, has `deploy-preview` label | run               | preview | `preview`          |
| Preview never came up (any author)                   | run (fallback)    | staging | `staging-fallback` |
| Scheduled (nightly cron)                             | run               | staging | `staging`          |
| `workflow_dispatch` with `inputs.baseUrl`            | run               | input   | `dispatch`         |
| `workflow_dispatch` without `inputs.baseUrl`         | run               | staging | `staging`          |

`mode` flows into the on-failure PR comment so the author sees
the right hint for why their tests ran where they did (e.g. a
`mode=staging-disabled` failure tells a human author to flip
`DEPLOY_PREVIEW_ENABLED` back on, not to add the `deploy-preview` label).

The preview path keeps its 5-minute poll with a **staging
fallback** if the preview never comes up (deploy failure, Vercel
quota hit, etc.) — so a deploy-side failure no longer silently
soft-skips the integration tests; we get a smoke test instead.

## Why staging is a useful default

- **Always available.** Staging is the deployed result of the
  last merge to `staging`. No polling, no waiting.
- **Catches contract drift on main.** A Dependabot bump that
  accidentally regressed the deployed spec or a Postman
  collection test would fail against staging on the next PR
  even before that PR merges. Today's preview-only model means
  the regression has to wait for someone to open an
  API-affecting PR with the right label.
- **Useful for non-API-affecting PRs**... in theory. We don't
  do this here — the existing `outputs.api != 'true'` skip
  gate stays, because running Postman on every docs / CLI PR
  would be noise. Staging smoke tests run nightly via the cron
  schedule already.

## Why fall back to staging instead of soft-skipping

Today: preview not ready → soft-skip with notice → workflow
shows SUCCESS but nothing ran. Misleading rollup.

Proposed: preview not ready → warn, target staging → workflow
shows SUCCESS because something actually ran. Smoke test
catches contract drift instead of being a no-op.

Trade-off: when a deploy genuinely fails, the integration
tests don't fail loudly — they pass against staging while
the deploy is broken. Mitigation: the `Vercel – rando-api`
check on the PR rollup goes red on deploy failure; reviewers
should look at the actual deploy status, not just the integration
tests result. Documented in MAINTAINING.md.

## Options considered

- **Reviewer's narrow fix: just add the author gate.** Mirrors
  deploy.yml's Dependabot skip. Saves the polling waste but
  abandons Dependabot PRs as a validation surface entirely.
  Smallest possible change. Skip — staging fallback is barely
  more code and gives us a smoke test signal we don't have
  today.
- **Always target staging, never preview.** Simplest possible
  model. Loses the "validate the PR's own contract" property
  that targeting preview was originally meant to give. Skip —
  the preview path is still valuable for human-authored
  API-affecting PRs.
- **Skip the workflow when preview won't exist.** Same effect
  as the reviewer's narrow fix for cost; no validation when
  Dependabot bumps land. Skip.
- **Run on a different schedule.** Move integration tests off
  `pull_request` events entirely and rely on the nightly cron.
  Loses PR-level validation entirely; defeats the purpose of
  catching contract regressions before merge. Skip.

## What we accept

- **Behavior change for Dependabot PRs.** They now run a real
  staging smoke test on every sync instead of soft-skipping.
  This is mostly the same Postman collection that the nightly
  cron runs, so it shouldn't add much load to staging itself.
  Concurrency is per-PR (existing `concurrency: group` line),
  so 10 Dependabot syncs in parallel run as 10 separate Postman
  runs against staging — same shape as the nightly. Should be
  fine.
- **A deploy.yml failure no longer surfaces in
  integration-tests.** The fallback path means integration
  tests succeed against staging even when the PR's own
  preview deploy went red. The deploy failure stays visible
  via the `Vercel – rando-*` checks and the `Deploy preview`
  workflow check. Documented in MAINTAINING.md so reviewers
  know to look there.
- **Integration-test failures may surface unrelated-to-the-PR
  staging regressions.** When the staging-fallback / Dependabot-
  smoke-test path is taken, a failure could mean either "this
  PR broke something" or "staging is broken and your PR ran
  against it." Mitigation: the failure-comment posted on the
  PR is mode-aware — when running against staging or via
  fallback, the comment includes an explicit hint pointing at
  the nightly cron / Vercel checks before the author starts
  debugging their own bump. The vanilla preview path keeps
  the original (no extra hint) failure comment because
  failures there reliably trace back to the PR.
- **The gate logic duplicates deploy.yml's.** Both compute
  "should this PR have a preview" via the same three signals:
  `vars.DEPLOY_PREVIEW_ENABLED != 'false'`, `github.actor != 'dependabot[bot]'`,
  and `contains(labels, 'deploy-preview')`. If deploy.yml's gate ever
  changes, integration-tests has to follow. Acceptable for two
  workflows; if a third needs the same signal, extract into a
  composite. The `DEPLOY_PREVIEW_ENABLED` toggle is particularly
  important to mirror — without it, flipping the var to `false`
  (the documented kill switch used until the Vercel projects
  exist; see deploy.yml header re: #75) would route deploy.yml
  off but leave integration-tests polling for previews that will
  never come up.

## What would make us reconsider

- **Staging gets shaky / frequently broken.** If staging being
  intermittently red causes many integration-test false-fails,
  switch defaults: skip Dependabot entirely instead of
  staging-smoke-test. (Effectively the reviewer's narrow fix.)
- **A new validation surface lands** that needs different
  targeting logic (e.g. `prod`-targeted health checks on a
  release tag). Extract the gate logic into a composite at
  that point.
- **We move to Vercel Pro** and the quota concern dissolves.
  Reconsider whether the staging fallback adds enough value
  to keep; might just go back to preview-only.

## Touch points

1. `.github/workflows/integration-tests.yml` — collapse "Compute
   target URL" + "Wait for target" + "Skip if not ready" into a
   single "Resolve target URL" step that picks staging vs preview
   based on the author/label gate, polls preview when expected,
   falls back to staging when preview never comes up.
2. `.github/MAINTAINING.md` — section under "Continuous
   integration" or "Deploy strategy" explaining the smart-target
   model and the "watch the Vercel checks, not just integration
   tests" reviewer guidance.

Related: [[ci-preview-quota-strategy]] (#184),
[[ci-per-app-preview-gating]] (#186), [[ci-deploy-skip]]
