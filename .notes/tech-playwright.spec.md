---
status: proposed
issue: 237
---

# Playwright E2E testing

## Why

Today's test coverage stops at the vitest unit layer. Integration
tests (`integration-tests.yml`) hit the API via Postman against a
preview / staging URL, but that's contract-level — it doesn't
exercise UI flows. Browser-driven E2E catches the gaps:

- Click-through sign-in / sign-up via Clerk
- Form validation paths in web + admin
- Routing transitions (Next 16 app-router boundaries)
- Visual regressions (with `--update-snapshots` workflow)

The `deploy-preview` label-gated PR previews give us a perfect
target — Playwright can run against the freshly-deployed branch
URL.

## Decision

Single `tooling/playwright` workspace running against deployed URLs
(preview / staging / production), parameterized at test time.

Tests live in `tooling/playwright/tests/{web,admin}/**/*.spec.ts`
organized by app. Workspace owns:

- `playwright.config.ts` — projects per browser (chromium / firefox /
  webkit), parameterized `baseURL` via env var
- `tests/{web,admin}/` — per-app smoke + flow suites
- `fixtures/` — shared helpers (auth setup, test users)

CI integration: new workflow `playwright.yml` that runs on:

- **PR with `deploy-preview` label** — against the PR's preview URL
  (waits for preview to be ready via existing
  `ci-integration-tests-smart-target` pattern)
- **Nightly cron** — against staging
- **`workflow_dispatch`** — manual against any URL

Skip on PRs without `deploy-preview` label (no URL to hit).

## Test scope (Phase 1)

Just the smoke tests — keep the suite under ~30 seconds per browser:

- **Auth smoke**: sign-in form loads, Clerk modal opens, /sign-in
  redirect works
- **Home loads**: web `/` renders without errors, admin `/` renders
- **Critical form**: contact add (web), user invite (admin)

Phase 2 (separate spec when needed): broader flow coverage, visual
regression baseline, auth-state fixtures.

## Why Playwright over Cypress / WebdriverIO

| Tool                    | Pros                                                            | Cons                                                    |
| ----------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| **Playwright** (chosen) | Multi-browser, fast, parallel by default, Microsoft maintenance | Bigger install footprint                                |
| Cypress                 | Better dev UX (test runner), strong docs                        | Single-tab assumption breaks Clerk modals; slower in CI |
| WebdriverIO             | Standards-based (W3C)                                           | More config, less community for React-app testing       |

## Touch points

1. `tooling/playwright/` — new workspace with config + tests
2. `tooling/playwright/package.json` — `@playwright/test` devDep
3. `tooling/playwright/tests/{web,admin}/smoke.spec.ts` — Phase 1 suites
4. `.github/workflows/playwright.yml` — new workflow
5. `apps/web/playwright-stub` or similar — N/A; tests live in tooling
6. `pnpm-workspace.yaml` — no change (already covers `tooling/*`)
7. Auth: a test Clerk instance / test user provisioned outside the
   spec; doc this in CONTRIBUTING.md
8. `rando.config.json` — extend with a `testing.e2e: { kind: "playwright" }`
   entry to match the existing `testing.api` shape (adapter pattern
   consistency)

## What we accept

- **Native apps stay outside Playwright.** Native E2E uses Maestro /
  Detox / similar — different stack, different spec.
- **No visual regression in Phase 1.** Snapshots are flaky without a
  baseline machine; defer to Phase 2 when we have a stable CI
  environment for it.
- **Tests are gated on `deploy-preview` label** for the PR path. PRs
  without label skip Playwright; nightly cron against staging covers
  the unlabeled gap.

## What would make us reconsider

- **Test flake exceeds 5% of runs.** Playwright is usually solid; if
  Clerk's hosted UI changes break selectors, we either pin a Clerk
  version or move to `page.locator(role)` patterns.
- **CI cost (minutes / month)** grows beyond the GitHub free tier.
  At that point: drop nightly cron, run Playwright only on
  `deploy-preview`-labeled PRs.

## Refs

- `ci-integration-tests-smart-target.spec.md` — the same URL-resolution
  pattern reused here
- `tech-clerk.spec.md` — auth surface tested by Phase 1
