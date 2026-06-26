---
status: archived
issue: 175
closed: 2026-06-23
---

# `testing.api` — make the adapter actually pluggable

## Decision

Wire the `testing.api.kind` discriminator (added 2026-06-22) into the adapter
factory so the implementation can be swapped between Postman and an
alternative (Insomnia, Bruno, Newman-CI-only) without touching CLI commands.
Today the config has the right shape but the code below it still hard-codes
Postman.

## Why

- **The discriminator is currently inert.** `packages/cli/src/setup-config.ts`
  declares `testing.api.kind: z.enum(['postman'])` and `rando.config.json`
  carries `kind: 'postman'`, but nothing reads it. `adapters.postman()` in
  `packages/cli/src/config.ts:161` unconditionally returns a
  `PostmanRestProvider`. Compare with `tracker()` (`config.ts:127`), which
  reads `cfg.tracker.kind` and dispatches between Jira and GitHub Issues —
  that's the precedent to follow.
- **Vendor-named domain interface.** `packages/cli/src/domain/postman.ts`
  exposes `PostmanProvider`. A swap requires a vendor-neutral parent
  (`ApiCollectionProvider` / `ApiTestingProvider`) that both
  `PostmanRestProvider` and a future `BrunoProvider`/`InsomniaProvider`
  satisfy. The Postman-specific bits (workspaces, Spec Hub) become adapter
  internals, not interface surface.
- **Vendor-named command path.** `rando api postman sync` reads as
  vendor-specific because it is. Either rename to `rando api sync` (kind
  inferred from config, flag override possible) or keep vendor-specific
  subcommands and add `rando api bruno sync` siblings. The former is closer
  to how `rando issues` works (single command, kind-driven).
- **Hard-coded doctor / init flows.** `packages/cli/src/doctor/checks/env.ts:86`
  unconditionally probes `POSTMAN_API_KEY`; `commands/init.ts:108` stamps
  `kind: 'postman'` literally; `TOKEN_HELP` lists `POSTMAN_API_KEY` directly.
  A Bruno setup has no API key (file-based), so these checks would need to
  be conditional on `cfg.testing.api.kind`.

## Options considered

- **Stay vendor-locked, drop the `kind` discriminator.** Honest about the
  current state. Cost: closes the door on swaps; future-us has to either
  re-introduce the seam or fork the CLI. Skip — we've already paid the
  config-shape cost, finishing the wiring is small.
- **Generic `ApiCollectionProvider` interface + dispatching factory.**
  Mirrors `tracker`. Smallest change that actually delivers swap-ability.
  Recommended.
- **Per-vendor command surface (`rando api postman sync`,
  `rando api bruno sync`).** Easier per-command UX (each can expose its own
  flags) but every command needs n implementations. Worse than the
  dispatching `rando api sync` for the cases we have today (one tool active
  at a time per repo).

## What we accept

- **Some Postman-specific concepts leak.** Workspaces are a Postman idea;
  Bruno uses local directories with `.bru` files and Insomnia uses workspace
  exports. A generic interface either lowest-common-denominators these
  (just "where do collections live") or admits vendor-specific config
  blocks under `testing.api.<kind>` (like `tracker.github.labels` vs
  `tracker.jira.transitions`). The latter is what `tracker` does — follow
  that.
- **`POSTMAN_API_KEY` becomes optional.** Doctor checks already mark it
  optional (`env.ts:91`) so the immediate behavior is fine; the change is
  the probe becoming conditional on `kind === 'postman'`.
- **One env-var rename if we ever drop Postman.** `POSTMAN_API_KEY` is
  baked into 1Password Environments + `.env.example`. Swap-out is config
  - secret-store work, not just code.

## What would make us reconsider

- Discovering that Postman's free-tier API is sufficient for everything we
  want (Newman in CI, mocks, monitors) and the swap pressure evaporates.
  In that case: drop the `kind` discriminator, accept vendor lock-in,
  delete this spec.
- A frontend / consumer joining who has a hard Bruno preference. That's
  when the swap actually has to happen, not just be possible.

## Touch points (concrete file list)

1. `packages/cli/src/setup-config.ts` — extend `kind` enum when a real
   second adapter lands; before that, no schema change needed.
2. `packages/cli/src/domain/postman.ts` → rename / add parent interface.
3. `packages/cli/src/config.ts:161` — convert `postman()` into a
   `kind`-dispatching factory; rename to `apiTesting()` for accuracy.
4. `packages/cli/src/commands/api.ts` — either rename subcommands or
   re-route through a single `sync`. Keep the `--workspace` override.
5. `packages/cli/src/doctor/checks/env.ts:86` — conditional probe on
   `cfg.testing?.api?.kind`.
6. `packages/cli/src/commands/init.ts` — `writePostmanWorkspaceId` becomes
   `writeApiTestingWorkspaceId`, stamps the right `kind` from a parameter.
7. Tests: `__tests__/commands.test.ts` + `__tests__/postman.test.ts` add
   coverage for the dispatch path.

Related: [[tech-postman-spec-sync]], [[project_rando_cli]]
