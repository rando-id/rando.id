# GitHub security + quality baseline (2026-06-25)

Snapshot of what's enabled, what's missing, and what couldn't be read
with the current PAT. Discovery pass — captures the starting point for
the security + quality work session planned next. Plain notes
(not a `.spec.md`) — forward-looking decisions get their own specs
referencing this.

## What's enabled and visible

### Repo settings (via `gh api repos/<owner>/<repo>`)

| Setting                | Value  |
| ---------------------- | ------ |
| visibility             | public |
| default_branch         | main   |
| allow_squash_merge     | true   |
| allow_merge_commit     | false  |
| allow_rebase_merge     | false  |
| allow_auto_merge       | true   |
| delete_branch_on_merge | true   |
| has_issues             | true   |
| has_discussions        | true   |

Merge model is locked to squash-only with auto-delete — clean.

### Branch rulesets

One active ruleset (`id=18143243`, name `main`, target `branch`,
enforcement `active`) covering:

- Block branch deletion + non-fast-forward push
- Squash merge method only
- Required status checks (strict mode): `ESLint + Prettier + OpenAPI
spec`, `tsc --noEmit (every workspace)`, `vitest + coverage`
- Required review thread resolution (every Devin / human thread must
  resolve before merge — bit us multiple times today)
- Code quality severity threshold: `warnings`
- CodeQL scanning thresholds: `errors` for general alerts,
  `high_or_higher` for security alerts
- 0 required approving reviewers (solo flow)

### Workflows on disk

```
codeql.yml             — CodeQL action runs on PRs + nightly
deploy-preview.yml     — opt-in via `deploy-preview` label
deploy-production.yml  — workflow_dispatch + Environment reviewer
deploy-staging.yml     — push to staging
integration-tests.yml  — Postman against preview / staging
issues.yml             — issue lifecycle transitions
lint.yml               — eslint + prettier + spectral
sync-staging.yml       — fast-forward staging from main
typecheck.yml          — tsc per workspace
unit-tests.yml         — vitest + coverage upload
```

Not present (could be added per the security/quality ideas):
`dependency-review.yml`, `scorecard.yml`, secret-scan trigger,
SAST (semgrep / snyk).

### Docs / templates

| File                                                             | Status                            |
| ---------------------------------------------------------------- | --------------------------------- |
| `.github/SECURITY.md`                                            | exists (2.1K) — disclosure policy |
| `.github/CONTRIBUTING.md`                                        | exists (18K) — full dev guide     |
| `.github/MAINTAINING.md`                                         | exists (38K) — ops / deploy SOP   |
| `.github/PULL_REQUEST_TEMPLATE.md`                               | exists                            |
| `.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml` | exists                            |
| `.github/CODEOWNERS`                                             | **missing**                       |

### Org / advisories

- 0 published security advisories
- 0 draft security advisories
- Org 2FA: PAT can't read

## PAT-gated (manual UI check needed)

The PAT used today returns 403 on these endpoints. Reading them
needs a fine-grained PAT with `Administration: read` or
`Security events: read` (same scope set #222 calls out).

| Endpoint                             | What it tells us                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `repos/.../vulnerability-alerts`     | Whether Dependabot security alerts are enabled                                    |
| `repos/.../dependabot/alerts`        | Open security advisories on installed packages                                    |
| `repos/.../code-scanning/alerts`     | Open CodeQL findings                                                              |
| `repos/.../secret-scanning/alerts`   | Committed secrets detected                                                        |
| `repos/.../branches/main/protection` | Legacy branch protection (we use rulesets instead — but might also be configured) |
| `orgs/rando-id` 2FA flag             | Org-level 2FA enforcement                                                         |

**These toggles are now automated** via `rando vc security` (see
`.notes/tool-gh-api-coverage.spec.md`). Single command flips:

- Dependabot vulnerability alerts + automated security fixes
- Secret scanning + push protection
- Private vulnerability reporting
- Org-level 2FA requirement (with `--include-org-2fa`, opt-in because
  it kicks members without 2FA out of the org)

The audit / counts side (open advisories, CodeQL findings, etc.) is
still UI-driven — no API for "show me the current numbers" without a
fine-grained PAT with `Security events: read`. Counts to record once
available:

1. Security tab → Dependabot → open advisories.
2. Security tab → Code scanning → open CodeQL alerts.
3. Security tab → Secret scanning → open detections.

The only operator step that stays manual is **PAT creation** —
GitHub doesn't expose an API for minting fine-grained PATs, so the
operator generates one in Settings → Developer settings → Personal
access tokens, runs `rando vc setup --admin-token "$PAT"`, then
deletes the PAT in the same UI when the run finishes (the command
prints the cleanup link on its way out).

## Gaps identified by inspection

### High-confidence

1. **No CODEOWNERS file.** Rulesets currently require 0 approving
   reviewers (solo flow). When a second contributor lands, CODEOWNERS
   is the natural way to gate prod-touching directories without
   forcing reviews on every doc PR. Also needed for GitHub
   Environment "production" reviewer wiring to be tied to file paths
   rather than the merger themselves.
2. **No dependency-review workflow.** GitHub ships
   `actions/dependency-review-action` that blocks PRs introducing
   vulnerable deps or license violations. We have Dependabot
   _bumping_ deps but no gate on _new_ deps a contributor adds.
3. **No supply-chain scoring.** GitHub's
   `ossf/scorecard-action` runs OpenSSF Scorecard and surfaces
   policy gaps (pinned-actions, signed-commits, branch-protection,
   etc.) into Code scanning. Public repo with no production users
   yet — low risk today, but the scorecard report is also a useful
   self-audit dashboard.
4. **Action pins are mixed.** Most actions in our workflows are
   SHA-pinned (good — Dependabot bumps them weekly). Worth a sweep
   to confirm there's no `actions/checkout@v6` style version-tag
   pin remaining.
5. ~~**No stale-issue/PR automation.**~~ Closed via #262 / #264 —
   `.github/workflows/stale.yml` runs daily; tunings documented in
   `.notes/ci-stale-automation.md`.
6. **PR template doesn't require security-impact line.** For a
   solo repo this is fine; for any open-source contribution surface
   it's a gap (a PR touching auth code should self-flag).

### Automated via `rando vc security` (no UI clicks required)

7. **Dependabot security updates.** Auto-opens PRs for vulnerable
   transitive deps. Enabled by `rando vc security` via
   `PUT /repos/{o}/{r}/automated-security-fixes` (+ the prereq
   `vulnerability-alerts` endpoint).
8. **Private vulnerability reporting.** Lets external researchers
   privately disclose via GitHub's form. Enabled by `rando vc
security` via `PUT /repos/{o}/{r}/private-vulnerability-reporting`.
   `SECURITY.md` already points reporters at the form (#262).
9. **Secret scanning + push protection.** Blocks commits with known
   secret formats _before_ they hit the remote. Enabled by `rando
vc security` via `PATCH /repos/{o}/{r}` with the
   `security_and_analysis` block.

### Low-priority (existing pattern works for solo flow)

1. **No required signed commits.** Devin / Dependabot bot commits
   can't be signed. Worth deferring until a second human contributor.
2. **PR description templates don't enforce a security checklist.**
   Same — solo-flow doesn't need it.

## Related existing tickets

- **#217** — `op-env` env-id explicit (potential risk around vault
  secrets — secret scanning angle).
- **#222** — `rando setup gh` automating repo config (this baseline
  is exactly what that command would set + verify).
- **#228** — react/react-dom override drift (supply-chain hygiene).
- **#229** — stale react-native-worklets override (same).
- **#230** — native CI build verification (quality, not security).

## Recommended discovery output

Three buckets for the next session:

| Bucket                                              | Items                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Automated via `rando vc security`** (no UI flips) | Dependabot security updates, secret scanning + push protection, private vulnerability reporting, org 2FA (`--include-org-2fa`)       |
| **New workflow files**                              | `dependency-review.yml` (#250), `scorecard.yml` (#250), `stale.yml` (#262) — all shipped                                             |
| **Repo file additions**                             | `CODEOWNERS` (#249), `SECURITY.md` updated to point at the GH private-vuln form (#262), security checklist in PR template (optional) |

Each item in buckets 2 + 3 deserves a short `.spec.md` if the user
wants to compare options (action pins, ruleset additions, etc.) —
otherwise file an issue and implement.
