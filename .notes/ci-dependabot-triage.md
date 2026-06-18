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

## Triage of the existing PRs — deferred

Plan once we see how the new config behaves next Monday:

1. **Close per-workspace dupes** that overlap with root-grouped PRs.
2. **Merge the safe patches** (actions-org SHA-only, expo + react-dom patches).
3. **Leave risky majors open** with triage notes for individual investigation.

### Reference snapshot — every Dependabot PR open as of this commit

Captured here so triage decisions survive PRs getting closed/rebased.

**Safe-ish patches (merge candidates)**

| #    | Bump                                                    | Risk        |
| ---- | ------------------------------------------------------- | ----------- |
| #114 | actions-org group (3 updates, SHA-only since we pinned) | low         |
| #136 | react-dom 19.2.3 → 19.2.7 in /apps/native               | low (patch) |
| #142 | expo 56.0.8 → 56.0.12 in /apps/native                   | low (patch) |

**Major bumps — investigate individually**

| #                                              | Bump                                                                          | Risk                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| #102                                           | commander 12.1.0 → 15.0.0 in /packages/cli                                    | major × 3 — CLI breakage risk                                          |
| #103, #109, #113, #132                         | zod 3.25.76 → 4.4.3 (config / api-client / auth / api)                        | major — breaking                                                       |
| #104, #106, #110, #120, #127, #128, #134, #140 | @vitest/coverage-v8 2.1.9 → 4.1.9 (per workspace)                             | skip-major (v2→v4)                                                     |
| #105                                           | react-native 0.85.3 → 0.86.0 in /apps/native                                  | minor but expo-coupled                                                 |
| #107, #108, #160                               | @clerk/nextjs 6.39.5 → 7.5.4 (admin / web / root clerk group)                 | major                                                                  |
| #111, #146, #152                               | eslint 9.39.4 → 10.5.0 (cli / native / root eslint group)                     | major — config breaking                                                |
| #112, #123, #144                               | react + @types/react bump (ui / native / admin)                               | peer-dep wrangling                                                     |
| #115, #119, #126, #158                         | tamagui 1.144.4 → 2.3.0 (ui / web / @tamagui/config × 2 / root tamagui group) | major                                                                  |
| #116, #124, #155                               | next 15.5.19 → 16.2.9 (api / admin / root next group)                         | major — app router changes                                             |
| #117, #148-153                                 | vitest 2.1.9 → 3.2.6 (per workspace + root vitest group #154)                 | major — config + threshold semantics changed                           |
| #118, #121, #122, #129, #137, #139             | typescript 5.7.3 → 6.0.3 (per workspace)                                      | major — strict mode tweaks                                             |
| #125, #157, #159                               | drizzle-orm 0.38.4 → 0.45.2 (db / root + drizzle group)                       | major — SQL builder changes                                            |
| #130, #131, #141, #143, #156                   | vitest 2.1.9 → 4.1.9 (per workspace, skipping v3)                             | skip-major                                                             |
| #133, #145, #147                               | @types/node 22.19.19 → 25.9.3 (admin / api / root types group)                | major (node typings shifted)                                           |
| #135                                           | github/codeql-action 3.36.2 → 4.36.2                                          | major; we just pinned v3 last commit, look at changelog before bumping |
| #138                                           | npm_and_yarn group across 1 directory with 2 updates (/packages/db)           | check body for what's grouped                                          |
| #161                                           | expo group with 3 updates                                                     | could be safe (sibling patches) or include major — inspect             |

### Why so many dupes

Several of these (e.g. all the vitest entries #117/#148-153, all the @vitest/coverage-v8 #104/#106/#110/#120/#127/#128/#134/#140, all the typescript #118/#121/#122/#129/#137/#139) exist because the pre-anchor config had no `groups:` on per-workspace entries. After this commit lands and Monday's run happens, the root-grouped versions should rebase to supersede them and Dependabot auto-closes the dupes — or we close them by hand.

## Decision

Push the config, leave existing PRs alone until next Monday's run.
That gives us a control: if the new config groups them properly,
many of the existing dupes will be auto-superseded by the new
grouped PRs (dependabot rebases) and we save the close-with-comment
work.

If we'd rather just close all 49 and start fresh, that's an alternate
plan we can pick up any time.
