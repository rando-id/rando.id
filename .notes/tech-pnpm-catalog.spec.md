---
status: proposed # draft → proposed (issue filed) → approved (milestone attached)
issue: 223
---

# pnpm workspace catalog for shared dev deps

## Why this exists

Today (2026-06-25) the TypeScript 5→6 sweep across 13 workspaces
required **three rounds of lockfile regeneration** as siblings landed
on main. Every Dependabot PR for a cross-cutting dep produces a
lockfile diff that drifts the moment another sibling merges. That's
not a Dependabot bug — it's a direct consequence of the same dep
being declared in N `package.json` files. N declarations → N PRs →
N-1 cascade rounds per batch.

Empirical breakdown of cross-workspace duplication (run via
`jq … | sort | uniq -c`):

| Dep                   | Workspaces declaring it |
| --------------------- | ----------------------: |
| typescript            |                      16 |
| vitest                |                       9 |
| @vitest/coverage-v8   |                       9 |
| @types/node           |                       6 |
| eslint                |                       5 |
| @types/react          |                       5 |
| zod                   |                       5 |
| tsx                   |                       3 |
| @types/react-dom      |                       3 |
| react / react-dom     |                   5 / 4 |
| tamagui / @tamagui/\* |                   3 / 3 |
| next                  |                       3 |
| @clerk/nextjs         |                       3 |

The 8 highest rows (typescript through @types/react-dom) are pure
dev-tooling — no runtime semantics ride on the version. They're the
class of bump where "every workspace gets the same version" is the
_only_ correct outcome.

## Decision

Migrate the dev-tooling cluster to pnpm's `catalog:` feature
(stable in pnpm 10.4+, supported by Dependabot since
[pnpm/pnpm#13245](https://github.com/pnpm/pnpm/pull/13245) and
[dependabot-core#12150](https://github.com/dependabot/dependabot-core/pull/12150)).

`pnpm-workspace.yaml` becomes the **single source of truth** for the
catalog'd versions:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'

catalog:
  # Type checker — shared across every TS/TSX workspace.
  typescript: ^5.7.2

  # Test runner + coverage — must move in lockstep.
  vitest: ^2.1.9
  '@vitest/coverage-v8': ^2.1.9

  # Lint + Node typings.
  eslint: ^9.39.4
  '@types/node': ^22.19.19

  # TypeScript script runner.
  tsx: ^4.20.6

  # React typings — kept in catalog because every React-using
  # workspace needs them in lockstep with the runtime React version.
  '@types/react': ^19.2.3
  '@types/react-dom': ^19.2.3
```

Each `package.json` references the catalog via the `catalog:`
keyword:

```json
{
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:",
    "@vitest/coverage-v8": "catalog:"
  }
}
```

Net effect: a TypeScript 5→6 bump becomes **one PR** that edits a
single line in `pnpm-workspace.yaml`. No 13-fan-out. No lockfile
cascade. Today's three sweep rounds collapse to zero.

## What enters the catalog (and what doesn't)

### Phase 1 — dev tooling (this spec's scope)

| Dep                 | Workspaces | Catalog? |
| ------------------- | ---------: | -------- |
| typescript          |         16 | ✓        |
| vitest              |          9 | ✓        |
| @vitest/coverage-v8 |          9 | ✓        |
| @types/node         |          6 | ✓        |
| eslint              |          5 | ✓        |
| @types/react        |          5 | ✓        |
| @types/react-dom    |          3 | ✓        |
| tsx                 |          3 | ✓        |

These 8 deps account for the bulk of Dependabot churn. Versions
already aligned across workspaces today (no app-specific pins),
so the migration is a syntactic swap.

### Phase 2 — app framework deps (separate spec / issue)

| Dep             | Workspaces | Notes                                                       |
| --------------- | ---------: | ----------------------------------------------------------- |
| react           |          5 | Catalog candidate but check native vs web peer ranges first |
| react-dom       |          4 | Lockstep with react                                         |
| next            |          3 | Used by api / admin / web                                   |
| @clerk/nextjs   |          3 | Just bumped to v7 — wait for stability                      |
| tamagui         |          3 | Verify @tamagui/config tracks tamagui major                 |
| @tamagui/config |          3 | Lockstep with tamagui                                       |

Deferred to a separate spec because:

- React Native version constraints differ from web (apps/native uses
  `~5.7.2` tilde for typescript today; phase 1 doesn't change that
  because catalog still allows per-workspace overrides via explicit
  versions when needed).
- Recent major bumps (Clerk 6→7) might want a settling period before
  catalog'ing.

### Phase 3 — runtime deps (low priority)

`zod` (5 workspaces) and `@tanstack/react-query` (2). Runtime
semantics matter; catalog'ing isn't urgent until we see actual
version drift causing bugs.

### Explicit non-catalog cases

| Class                          | Why not                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| Internal `@rando/*` workspaces | Resolved via `workspace:*`; catalog doesn't apply              |
| App-only deps                  | drizzle-orm (db only), commander (cli only) — single workspace |
| Native-only deps               | expo, react-native, etc. — different version policy anyway     |

## Why now and not earlier

Three things compound to make this the right moment:

1. **The empirical pain just happened.** Three sweep rounds today
   on a single major bump is the concrete data point. Filing this
   in calmer water lets the spec reference exact numbers.
2. **pnpm 10.4 + Dependabot support.** Both are mature now. Six
   months ago the catalog feature was experimental in pnpm and
   Dependabot had no awareness — migrating then would have created
   per-workspace fan-out via Dependabot anyway.
3. **The Dependabot triage queue is small.** ~30 PRs open today,
   shrinking. After this lands, future TypeScript/vitest/eslint
   bumps shouldn't reopen the cascade.

## Migration plan

Single-PR migration, mechanical:

1. **Add `catalog:` block to `pnpm-workspace.yaml`** with current
   versions for the 8 Phase 1 deps.
2. **Sweep `package.json`s** — replace concrete versions with
   `"catalog:"` in 16 (for typescript) + 9 + 9 + 6 + 5 + 5 + 3 + 3
   = ~56 lines of JSON across ~15 files. Mechanical sed-style.
3. **`pnpm install`** — regenerate `pnpm-lock.yaml`. Expect a
   large diff (lockfile re-resolves catalog references), but no
   actual version changes — exact same packages installed.
4. **`pnpm typecheck && pnpm lint && pnpm test:coverage`** —
   prove nothing broke. Cache thrash + full re-run expected.
5. **`.github/dependabot.yml` update** — pnpm-workspace.yaml
   becomes a Dependabot-watched manifest. Already includes the
   directory in `package-ecosystem: npm` if pnpm-workspace.yaml
   is detected, but worth verifying after migration with a
   forced bump (`@dependabot recreate` on any open PR).

Single commit OR split into "catalog scaffold" + "per-package
swap" — single commit is cleaner since the swap is invalid
without the catalog defs.

## What we accept

- **One-time lockfile churn.** The migration commit's
  `pnpm-lock.yaml` diff will be hundreds of lines. The content is
  syntactic (catalog refs replace concrete specifiers); no
  packages change. Reviewers can sanity-check by running `pnpm
list typescript` before/after and confirming the resolved
  version is identical.
- **Catalog is not enforcement.** A workspace can still declare
  a non-catalog version with an explicit specifier if it needs
  to (e.g. apps/native pinning a TypeScript for React Native
  compat). Catalog is the default, not a constraint.
- **pnpm lock-in.** Catalog refs are pnpm-specific syntax. If we
  ever swap pnpm for npm/yarn/bun, every `"catalog:"` becomes
  invalid. Acceptable — we're not planning the swap.
- **Dependabot will rebuild its grouping.** First post-migration
  bump may produce a mixed PR (some catalog refs, some not).
  Acceptable; the second bump onwards is clean.

## What would make us reconsider

- **pnpm regression** in catalog handling — bug that misresolves
  versions or breaks `pnpm install` on catalog refs. Roll back
  with `git revert` on the migration commit.
- **Dependabot's catalog support breaks** on a per-package basis.
  If we see Dependabot opening per-workspace PRs for a catalog'd
  dep after migration, that's a regression in their config — file
  upstream.
- **Need for per-workspace version drift.** Today every workspace
  is on the same TypeScript / vitest / eslint version. If a
  future requirement forces apps/native onto a different TypeScript
  (e.g. React Native 0.x compatibility window), that workspace
  opts out of the catalog for that dep specifically — not a
  rollback of the migration.

## Touch points

1. **`pnpm-workspace.yaml`** — add `catalog:` block with the 8
   Phase 1 deps. ~12 lines.
2. **`apps/api/package.json`** — swap concrete versions for
   `catalog:` on typescript, vitest, @vitest/coverage-v8,
   @types/node, eslint.
3. **`apps/admin/package.json`** — same plus @types/react,
   @types/react-dom.
4. **`apps/web/package.json`** — same plus @types/react,
   @types/react-dom, react, react-dom.
5. **`apps/native/package.json`** — typescript only (keep tilde
   if needed; consider per-workspace override).
6. **`packages/{api-client,auth,brand,cli,config,db,eslint-config,maps,observability,sync,testing,tsconfig,ui}/package.json`** —
   typescript + vitest + @vitest/coverage-v8 swap.
7. **`pnpm-lock.yaml`** — regenerated.
8. **`.github/dependabot.yml`** — verify `pnpm-workspace.yaml` is
   tracked. Update `groups:` config if any catalog'd dep needs
   different grouping semantics.
9. **`.github/CONTRIBUTING.md`** — one-paragraph "How dev deps
   are versioned" pointer for new contributors.
10. **`.github/MAINTAINING.md`** — short section under "Dependencies"
    documenting the catalog pattern + when to use catalog vs
    per-workspace.

Closes #223.

Related: [[ci-dependabot-triage]] (the running pain log this
spec answers), #224 (eslint-plugin-react v8 — catalog'ing
eslint doesn't unblock that, but future eslint plugin bumps
collapse to single PRs).
