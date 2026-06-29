---
status: approved # draft → proposed (issue filed) → approved (milestone attached)
issue: 276
---

# Tamagui — shared UI

## Decision

Tamagui (v4) for the shared component library in `packages/ui`,
consumed by `apps/web`, `apps/admin`, `apps/native`. Theme + tokens
live in `packages/config`.

## Why

- **One component surface for web + native.** Genuinely shared, not "web component that happens to import RN" — Tamagui compiles to optimized CSS on web and native View hierarchy on RN.
- **Themability.** Token-based design system; theme switching is one prop. Matters because the contacts app has light/dark + density variants.
- **Optimizing compiler.** Static-extraction-from-JSX removes runtime style overhead on the web target. Speed wins on the contacts list (50-200 items at a time).
- **Active maintenance.** Nate Wienert ships frequently; the React Native community has converged on it as the leading cross-platform option.

## Options considered

- **NativeWind** — Tailwind for React Native. Simpler model, but the cross-platform story is less mature for complex layouts and theme tokens.
- **Gluestack** — newer, less battle-tested.
- **React Native Paper / NativeBase** — RN-only, no web story without extra adapters.
- **Roll our own with `styled-components` + RN's StyleSheet** — possible, but reinventing the optimizing compiler isn't a startup-velocity move.

## What we accept

- **v4 shorthands are mandatory.** `p` not `padding`, `bg` not `backgroundColor`, etc. CLAUDE.md has this as a documented gotcha because longhand silently doesn't typecheck.
- **Build complexity.** `withTamagui` next plugin + babel plugin + the optimizing compiler add config surface. The `apps/web/public/tamagui.css` ENOENT issue we hit was a direct consequence.
- **Some web-only optimizations (CSS-in-JS subset) don't have native equivalents.** Rarely matters, occasionally bites.

## What would make us reconsider

- Tamagui maintainership becomes unhealthy → fork or migrate. Realistically, Nate has been consistent.
- A specific design language (e.g., HIG-faithful iOS) can't be expressed in Tamagui tokens → consider a platform-specific override layer.
- We decide web and native should DIVERGE rather than share. Then Tamagui's main benefit evaporates.
