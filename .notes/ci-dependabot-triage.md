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

## Session log

Append a dated entry each Monday triage. Captures what got closed /
merged / deferred so future-us can compare against the previous
state instead of re-deriving the dupe pairings every week.

### 2026-06-22 — first Monday after the anchor landed

**Queue at start:** 72 open Dependabot PRs (counted with
`gh pr list --state open --author "app/dependabot" --limit 100`).
Much higher than the original 49 because Dependabot kept opening
new singles for each per-workspace entry over the week, and the
YAML anchor didn't retroactively dedupe what was already open.

**Merged** (you clicked Merge in the UI — PAT lacks
`mergePullRequest` scope today, see `.notes/security-github-pat.md`):

| #    | Bump                            | Risk                   |
| ---- | ------------------------------- | ---------------------- |
| #114 | actions-org group (3 SHA bumps) | low — SHA-only refresh |
| #179 | github/codeql-action SHA bump   | low — same             |

**Closed as stale** (root-level singles superseded by root grouped
PRs):

| Closed | Why                                                                 | Kept                                        |
| ------ | ------------------------------------------------------------------- | ------------------------------------------- |
| #156   | vitest 2→3.2.6 root single (group goes to 4.1.9)                    | #154 vitest group                           |
| #157   | drizzle-orm root single                                             | #159 drizzle group (also bumps drizzle-kit) |
| #138   | mixed `npm_and_yarn` group in /packages/db (vitest + drizzle)       | #154 + #159                                 |
| #142   | expo single in /apps/native (was also failing every required check) | #161 expo group                             |

**Deferred — per-workspace singles (~36 PRs)**: not closed today.
The new YAML-anchor config attaches `groups:` to every
per-workspace entry, so the next Dependabot run should produce
per-workspace grouped PRs that subsume these. They won't
auto-close on their own (different head refs) but closing them
now would just queue up another ~10–15 grouped replacements.
Leaving them so next Monday's session can confirm-then-close.

**Major bumps — deferred** (no progress this week, all still
listed in the reference snapshot above): vitest 2→4, typescript
5→6, zod 3→4, eslint 9→10, next 15→16, drizzle 0.38→0.45,
clerk 6→7, react/tamagui majors. Pick one per session to actually
attempt.

**Queue at end:** 68 open. Net: −4 closed, +2 merged-and-deleted,
+0 opened. Expect ~10–15 new grouped PRs after next Dependabot
run; net at next session likely ~50–55 if we close the deferred
per-workspace singles then.

**For next Monday:**

1. Recount the queue. Compare against 68.
2. Identify per-workspace grouped PRs that landed (titles
   containing `the <pkg> group across 1 directory`). For each,
   close the matching per-workspace singles in favor of the
   group.
3. Pick **one** major batch to actually attempt. Suggested order
   (lowest-blast-radius first): typescript 5→6 (per-workspace
   tsc strictness tweaks) → vitest 2→4 (already grouped in #154,
   real test) → next 15→16 (app-router migration) → drizzle
   0.38→0.45 (SQL builder changes) → zod 3→4 / clerk 6→7
   (breaking).

### 2026-06-24 — first triage with previews opt-in (post #216)

**Context shift:** D3 (#216) landed earlier today. Previews are now
opt-in for every PR via the `deploy-preview` label, and Vercel
native deploys are off across all three projects (D1 — `rando infra
setup` ran live). Net effect: Dependabot PRs no longer burn quota
on rebase or sync. The queue is approachable for the first time.

**Queue at start:** 60 open. Net −8 from 2026-06-22's end-of-session
68, mostly via Dependabot rebases collapsing some stale heads.

**Closed as stale** (per-workspace singles superseded by groups —
the strategy queued up two Mondays ago finally has groups to
compare against):

| Closed | Why                                                    | Kept                                  |
| ------ | ------------------------------------------------------ | ------------------------------------- |
| #98    | @types/node single in /packages/db                     | #147 (types group)                    |
| #145   | @types/node single in /apps/api                        | #147 (types group)                    |
| #107   | @clerk/nextjs single in /apps/admin                    | #160 (clerk group)                    |
| #108   | @clerk/nextjs single in /apps/web                      | #160 (clerk group)                    |
| #125   | drizzle-orm single in /packages/db                     | #159 (drizzle group)                  |
| #92    | vitest 2→4 single in /packages/db (skip-major)         | #182 (db group: drizzle + vitest 2→3) |
| #101   | vitest 2→4 single in /packages/api-client (skip-major) | #150 (api-client vitest 2→3 group)    |
| #130   | vitest 2→4 single in /packages/config (skip-major)     | #96 (config vitest 2→3 group)         |
| #131   | vitest 2→4 single in /packages/auth (skip-major)       | #149 (auth vitest 2→3 group)          |
| #141   | vitest 2→4 single in /packages/cli (skip-major)        | #117 (cli vitest 2→3 group)           |
| #143   | vitest 2→4 single in /packages/maps (skip-major)       | #153 (maps vitest 2→3 group)          |

**Reversal from 2026-06-22's plan**: that session preferred the
2→4 skip-major (kept the root vitest group, closed the 2→3
per-workspace singles). This session goes the other way: keep
the **2→3 per-workspace groups** (now landed), close the **2→4
skip-major singles**. Reasoning: 2→3→4 in two steps surfaces
breakage at the smaller-delta boundary; skip-major bundles all
the breakage at once. The root 2→4 group (#154) is no longer in
the queue.

**Labeled for preview** (operator clicks merge in UI):

| #   | Bump                                   | Label                                                                              |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| #93 | react-dom 19.2.3 → 19.2.7 in /apps/web | `deploy-preview` — fires the preview to confirm web renders. Patch bump, low risk. |

**Not labeled — merge-as-is candidates** (patch React bumps,
unchanged behavior expected; integration tests against staging
cover the contract):

| #    | Bump                                      |
| ---- | ----------------------------------------- |
| #136 | react-dom 19.2.3 → 19.2.7 in /apps/native |
| #207 | react 19.2.3 → 19.2.7 in /apps/native     |
| #208 | react 19.2.3 → 19.2.7 in /packages/ui     |
| #209 | react 19.2.3 → 19.2.7 in /apps/admin      |

**Major bumps — deferred** (no progress this session, same list
as 2026-06-22 minus the 6 vitest-skip-major singles closed
above). Next session's batch pick: TypeScript 5→6 (10 per-workspace
singles — #94, #97, #99, #100, #118, #121, #122, #129, #137, #139).
Lowest blast radius — `tsc --noEmit` is already in CI; failures
surface immediately at typecheck.

**Queue at end:** 49 open. Net: −11 closed, 0 merged-locally
(operator merges 5 bucket-A patches separately in the UI),
0 opened. Expect ~5 fewer after the bucket-A merges land.

**For next session:**

1. Recount the queue. Compare against 49.
2. Attempt TypeScript 5→6 across the 10 per-workspace singles.
   Strategy: clone one (e.g. #99 /apps/api) locally, run
   `pnpm typecheck` after the bump, fix the strictness fallout.
   If clean → merge it, then repeat for the other 9. If breaking
   → write a `.notes/tech-typescript-6-migration.spec.md` capturing
   the breakage class + the per-workspace mitigations needed.
3. Sanity-check the vitest 2→3 per-workspace groups (#96, #117,
   #148-#151, #153, #167, #182 (mixed)) — these should be a clean
   merge wave once one passes locally.
