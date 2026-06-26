---
status: draft
issue: TBD
---

# Storybook setup — component lib + app stories + MSW

## Why

No Storybook today (zero hits in package.json across the repo). The
shared component lib in `packages/ui` has Tamagui-based primitives
consumed by `apps/web`, `apps/admin`, and `apps/native`, but there's
no isolated way to develop, document, or visually-regress them.
Page-level components live inside the apps with no story coverage
either. Adding Storybook closes both gaps and unlocks MSW-mocked
fixtures for component-level API state.

## Decision

Single Storybook instance at **`tooling/storybook`** that aggregates
stories from multiple sources. Three story scopes:

1. **`packages/ui/**/\*.stories.tsx`\*\* — primitives. Authored alongside
   the component, picked up by the aggregator.
2. **`apps/web/**/\*.stories.tsx`\*\* — full-page or feature-level
   composites that exercise routing / data hooks.
3. **`apps/admin/**/\*.stories.tsx`\*\* — same, for admin.

`tooling/storybook/main.ts` globs all three and surfaces them as a
single tree. Native components stay out — React Native + Storybook
is its own (heavier) setup; treat as a Phase 2.

Add-ons:

- `@storybook/addon-essentials` — controls, actions, viewport
- `@storybook/addon-a11y` — axe-core per-story
- `@storybook/addon-msw` — request mocks inline with stories
- `@chromatic-com/storybook` — visual regression baseline if Chromatic
  is adopted later (skip for now)

## Why a standalone `tooling/storybook` workspace

Three alternatives considered:

| Where                              | Pros                                                                           | Cons                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `packages/ui` only                 | Closest to the components; cheapest setup                                      | Misses app-level stories; doesn't model what real consumers see |
| `apps/web`                         | Stories live with usage                                                        | Forces Storybook into the Next.js build; duplication for admin  |
| **Standalone aggregator** (chosen) | Single Storybook URL covers all stories; per-app config doesn't bloat each app | One more workspace; needs cross-workspace globs                 |

The aggregator pattern matches how the testing stack already
works (vitest configs per workspace, but one root command runs all).

## MSW integration

`packages/testing` already ships MSW (verified via package.json scan).
Reuse:

- `packages/testing/src/msw/handlers.ts` — shared default handlers
- Per-story override: `parameters: { msw: { handlers: [...] } }`
  using `@storybook/addon-msw`

This means a story can mock `/contacts` and demonstrate loading /
error states without the real API. Same handlers shared with vitest
unit tests via the package.

## Touch points

1. `tooling/storybook/` (new workspace) — Storybook config, main.ts globs.
2. `tooling/storybook/package.json` — devDependencies on `storybook`,
   `@storybook/*` addons (catalog if multiple). Add `storybook`,
   `@storybook/react-vite` to catalog later if more than one workspace
   pulls them in.
3. `packages/ui/src/**/<Component>.stories.tsx` — start with the
   highest-value primitives (buttons, inputs, the contact card).
4. `apps/web/src/**/*.stories.tsx` — composites.
5. `apps/admin/src/**/*.stories.tsx` — composites.
6. `package.json` root script — `pnpm storybook` proxies to
   `pnpm --filter @rando/storybook dev`.
7. `.github/workflows/lint.yml` — add `--check` on the new package's
   stories directory if eslint config covers them.

## What we accept

- **Apps/native deferred** to a Storybook RN spec (separate). React
  Native + Storybook needs Expo dev-client or a separate Metro bundle.
- **No visual regression yet**. Chromatic / Percy is a future call;
  for now Storybook is dev-time + a11y-time, no CI gating on it.
- **One more workspace** — adds rebuild surface in Turbo. Mitigated
  by Turbo's per-task cache.

## What would make us reconsider

- **Per-app Storybook becomes friction** (e.g. apps/web stories need
  a different Storybook config than admin's). Split at that point.
- **Stories proliferate without test coverage**. Storybook is doc/dev,
  not test; if stories drift from prod and we keep them, that's
  rot. Lint-time check that every story has a corresponding usage
  in app code could catch this.

## Refs

- `tech-tamagui.spec.md` — UI library this documents
- `tech-msw.spec.md` — MSW expansion (sibling)
- `packages/testing` — already has MSW; will host shared handlers
