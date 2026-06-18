# Dependabot triage

The first Dependabot run opened 49+ PRs because most per-workspace
entries in our config don't have a `groups:` block — only the root
entry did. So the same `vitest` bump shows up as one PR per workspace
instead of grouped.

## Fix in this commit

Add a YAML anchor (`&npm_groups`) at the top of `.github/dependabot.yml`
and alias it (`*npm_groups`) into all 14 npm entries. Same groups
everywhere — adding a new group means editing the anchor block, not
14 entries.

Caveat: **Dependabot YAML anchors aren't officially documented.** Many
public repos use the pattern and it works in practice, but if GitHub's
schema validator rejects the top-level `_npm_groups` key, the fallback
is duplicating the groups block 14 times. Push, watch the Insights →
Dependency graph → Dependabot tab for a red banner. If broken, the
inline-duplicate path is mechanical.

## Triage of the existing 49 PRs — deferred

Plan once we see how the new config behaves next Monday:

1. **Close ~30 per-workspace dupes** that overlap with root-grouped PRs.
   - vitest bumps in /apps/api, /apps/web, /packages/cli, /packages/maps, /packages/auth, /packages/config, /packages/api-client → all same as root `vitest` group
   - typescript bumps per workspace → would be in a future root `typescript` group
   - same pattern for @types/node, eslint, etc.
2. **Merge ~3 safe patches**:
   - #114 actions-org group (already SHA-pinned; SHA bumps within current major)
   - #142 expo 56.0.8 → 56.0.12 (patch)
   - #136 react-dom 19.2.3 → 19.2.7 in /apps/native (patch)
3. **Leave ~10 risky majors open** with triage notes for individual investigation:
   - next 15 → 16 (#155, #116, #124)
   - vitest 2 → 4 (#117, #131, #141, #143, etc.) — skipping v3 entirely
   - eslint 9 → 10 (#152, #146)
   - drizzle-orm 0.38 → 0.45 (#157, #125)
   - zod 3 → 4 (#132, #113)
   - typescript 5.7 → 6.0 (multiple)
   - @types/node 22 → 25 (#147)
   - clerk 6 → 7 (#160)
   - tamagui 1 → 2 (#158, #119, #126)
   - codeql-action 3 → 4 (#135) — we just pinned to v3.36.2 last commit
   - @vitest/coverage-v8 2 → 4 (#110, #120, #127, #128, #134, #140)
   - react 19 → ? in /apps/admin and /apps/native (#144, #123) — peer-dep wrangling

## Decision

Push the config, leave existing PRs alone until next Monday's run.
That gives us a control: if the new config groups them properly,
many of the existing dupes will be auto-superseded by the new
grouped PRs (dependabot rebases) and we save the close-with-comment
work.

If we'd rather just close all 49 and start fresh, that's an alternate
plan we can pick up any time.
