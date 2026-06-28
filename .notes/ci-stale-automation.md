# Stale issue/PR automation policy

Operational note (not a spec — no options were compared, just an
implementation of the gap flagged in `security-github-baseline.md` #5).
Captures the tunings + the reasoning behind them so future-us doesn't
have to reverse-engineer from the YAML.

## Tunings

| Item   | Idle → stale | Stale → closed |
| ------ | ------------ | -------------- |
| Issues | 60 days      | +14 days       |
| PRs    | 30 days      | +14 days       |

PRs rot faster than issues because `main` moves underneath them — a
30-day-old PR usually needs a rebase before it's reviewable again, and
the act of rebasing resets the clock anyway. Issues are stable
artifacts; 60d gives genuinely useful tickets enough room to surface
without churn.

## Exempt labels

| Scope  | Labels                                              |
| ------ | --------------------------------------------------- |
| Issues | `pinned`, `security`, `keep-open`                   |
| PRs    | `pinned`, `security`, `keep-open`, `deploy-preview` |

`deploy-preview` is PR-only because labelled PRs are actively burning
Vercel quota — closing one would silently kill its preview env.

Draft PRs are auto-exempt (`exempt-draft-pr: true`) because drafts are
typically intentional WIP.

## Operational caps

- **60 ops/run** so a backlog spike (e.g. first run against a
  long-quiet repo) doesn't trip GitHub's rate limit. The scheduler
  fires daily; overflow lands the next day.
- **Cron**: 06:30 UTC daily, staggered from CodeQL (nightly) and
  Scorecard (07:20 UTC Monday).
- **No `start-date` filter.** The first version of this workflow set
  `start-date: ${{ github.event.repository.created_at }}` as a "first-
  run protection" guard. It's a no-op — `repository.created_at` is
  always older than every issue/PR, so the filter never excludes
  anything. Removed in the second commit on PR #262 (Devin caught it).
  The exempt-labels are the real protection: anything pre-labelled
  `keep-open` (or `pinned` / `security`) is already safe.

## How to escape

- Comment on the stale-tagged issue/PR to reset the idle counter.
- Label `keep-open` to permanently exempt.
- Push a new commit on a stale PR — same effect as a comment.
- `actions/stale@v10.3.0` is SHA-pinned; bumps come via Dependabot.

## Why this isn't a spec

No options were compared — `actions/stale` is GitHub's first-party
stale bot and the only reasonable choice. Tunings above are
conventional (matches what most public repos use). Documenting as
`ci-stale-automation.md` (plain note) rather than `.spec.md` keeps the
spec lifecycle for genuine forward-looking decisions.

## Refs

- Tracking issue: #264
- Implemented in: #262
- Identified as gap #5 in: `.notes/security-github-baseline.md`
