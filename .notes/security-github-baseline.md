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
SAST (semgrep / snyk), stale-issue automation.

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

**Manual baseline check to run in the GitHub UI**:

1. Settings → Security & analysis → confirm Dependabot **security
   updates** (not version updates) are on. Confirm secret scanning
   and push protection are on (private repos need a paid tier;
   public repo gets it free).
2. Security tab → Dependabot → count open advisories.
3. Security tab → Code scanning → count open CodeQL alerts (the
   ruleset would have blocked #102/#226 if any were errors).
4. Security tab → Secret scanning → count open detections.
5. Settings → Code security and analysis → check whether private
   vulnerability reporting is enabled.
6. Org Settings → Authentication security → 2FA enforcement state.

Record those counts in this doc as a follow-up entry once available.

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
5. **No stale-issue/PR automation.** Issues and PRs accumulate
   indefinitely. The Dependabot triage doc is the closest thing
   we have to a process — but no GitHub-side automation.
6. **PR template doesn't require security-impact line.** For a
   solo repo this is fine; for any open-source contribution surface
   it's a gap (a PR touching auth code should self-flag).

### Medium-confidence (needs UI check first)

7. **Dependabot security updates may not be enabled.** Different
   from version updates. Auto-opens PRs for vulnerable transitive
   deps regardless of our Dependabot config.
8. **Private vulnerability reporting may not be enabled.** Lets
   external researchers privately disclose security issues via
   GitHub UI rather than email (which SECURITY.md currently asks
   for).
9. **Secret scanning push protection may not be on.** Blocks
   commits that contain known secret formats _before_ they hit
   the remote.

### Low-priority (existing pattern works for solo flow)

10. **No required signed commits.** Devin / Dependabot bot commits
    can't be signed. Worth deferring until a second human contributor.
11. **PR description templates don't enforce a security checklist.**
    Same — solo-flow doesn't need it.

## Related existing tickets

- **#217** — make `op-env` require an explicit environment ID when
  resolving vault secrets, to reduce accidental cross-environment
  secret use/exposure (secret-scanning relevance).
- **#222** — `rando setup gh` automating repo config (this baseline
  is exactly what that command would set + verify).
- **#228** — react/react-dom override drift (supply-chain hygiene).
- **#229** — stale react-native-worklets override (same).
- **#230** — native CI build verification (quality, not security).

## Recommended discovery output

Three buckets for the next session:

| Bucket                                          | Items                                                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Pure config flips** (manual UI, no PR needed) | enable Dependabot security updates, enable secret scanning + push protection, enable private vulnerability reporting, set org 2FA |
| **New workflow files**                          | `dependency-review.yml`, `scorecard.yml`, stale-issue/PR automation, possibly secret-scan trigger                                 |
| **Repo file additions**                         | `CODEOWNERS`, security checklist in PR template (optional), update SECURITY.md to mention private vuln reporting once enabled     |

Each item in buckets 2 + 3 deserves a short `.spec.md` if the user
wants to compare options (action pins, ruleset additions, etc.) —
otherwise file an issue and implement.
