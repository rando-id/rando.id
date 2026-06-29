---
status: approved # draft → proposed (issue filed) → approved (milestone attached)
issue: 268
---

# CI base hardening

What to wire on top of the existing CI split (lint / typecheck /
unit-tests / integration-tests / deploy / issues workflows).

## What we're adding

- **`.github/dependabot.yml`** — monitor npm (root + workspaces) + github-actions + docker. Weekly cadence, grouped where sensible (e.g. all `@types/*` in one PR).
- **`.github/workflows/codeql.yml`** — TS/JS static analysis. Detects injection / XSS / hardcoded secrets / OWASP-class issues. Free for public repos. Runs on push + weekly cron.
- **SHA-pin GitHub Actions** — replace every `@v4` tag with a full commit SHA. Tag-pinning means a maintainer takeover could silently swap action code; SHA-pinning makes the action immutable from our side. Dependabot keeps the SHAs current via PRs.
- **Branch protection rules** — already on the post-CI-split punchlist (Settings → Branches → main/staging → require Lint, Typecheck, Unit tests).

## Considered + rejected

- **Renovate** instead of Dependabot — more configurable (better monorepo grouping, configurable schedules), but it's a third-party app you install on the repo. Skip unless we hit a real limitation in Dependabot. Built-in is fine for this scale.
- **PR auto-merge** for trivial dep bumps — possible but not yet. Want to eyeball the first few weeks of Dependabot PRs before automating away the review.

## Why SHA-pin (the supply-chain rationale)

GitHub Actions tag references (`@v4`) are mutable — the action author
can move the tag at any time. Two real-world attacks have happened
this way (tj-actions/changed-files in 2025, others). SHA-pinning makes
the action immutable from our side; Dependabot then proposes
SHA-bumps as PRs we explicitly review.

## Decision

Wire Dependabot + CodeQL + SHA-pin. Keep auto-merge off for now.
