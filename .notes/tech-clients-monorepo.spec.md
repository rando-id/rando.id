---
status: proposed
issue: 235
---

# Central clients package → `@theholocron/clients` monorepo

## Why

Today, fetch logic for third-party services is scattered:

- `packages/cli/src/adapters/*` — 11 vendor adapters (Vercel, Neon, Cloudflare, Clerk, 1P, GitHub, Postman, Jira)
- `packages/api-client/src/` — Rando's own API client (contacts, lists, contract)
- App-level fetch (apps/web's `src/lib/client-api.ts`, etc.)

CLAUDE.md already calls this out as a future direction: "centralize
fetch in a single `packages/clients` package." Three things are
now concrete enough to spec the actual move:

1. The adapter pattern is mature — every CLI adapter has a domain
   interface + impl + factory registration. Copying the shape to a
   shared package is mechanical.
2. The user owns `@theholocron` as a separate org / monorepo where
   shared cross-project packages already live (or are planned to).
   Publishing clients there means the next app (e.g. holonet) imports
   them by name rather than copying code.
3. Today's centralization is half-done — `packages/api-client` is
   already extracted but only consumed by /apps/web. The full move
   reuses the same lifting for vendor adapters too.

## Decision

Phased migration:

**Phase 1 — In-repo central package (`packages/clients`)**

- Create `packages/clients` with subpath exports:
  - `@rando/clients/vercel`
  - `@rando/clients/neon`
  - `@rando/clients/cloudflare/{tunnel,dns}`
  - `@rando/clients/clerk`
  - `@rando/clients/onepassword`
  - `@rando/clients/github/{api,cli,issues}`
  - `@rando/clients/jira`
  - `@rando/clients/postman`
- Move each adapter from `packages/cli/src/adapters/<vendor>.ts` →
  `packages/clients/src/<vendor>/` with the existing domain
  interface co-located.
- `packages/cli` becomes a consumer (`Adapters` factory imports
  from `@rando/clients/*`).
- `packages/api-client` either stays separate (Rando-app-specific) or
  moves under `@rando/clients/rando` — TBD when Phase 1 lands.

**Phase 2 — Extract to `@theholocron/clients`**

Once Phase 1 stabilizes (a few weeks of in-repo use):

- Set up the `@theholocron/clients` monorepo (separate GitHub repo
  under the theholocron org) with the same subpath layout.
- Publish each subpath as a separately-versioned npm package
  (`@theholocron/clients-vercel`, etc.) so consumers can install
  selectively.
- Rando swaps `@rando/clients/*` workspace dep for
  `@theholocron/clients-*` npm dep.
- The next app (holonet) imports the published packages directly —
  no copy-paste.

## Options considered

| Option                                           | Pros                                                 | Cons                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Stay scattered (status quo)**                  | Zero work                                            | Every new app reimplements adapters. Drift. Already painful in Rando alone.                       |
| **Phase 1 only — keep in-repo forever**          | One step, decisive                                   | When holonet starts, you'd copy `packages/clients` over OR git-submodule it. Both worse than npm. |
| **Skip Phase 1, jump to `@theholocron/clients`** | One move, cleaner                                    | Hard to extract correctly without first proving the API surface in-repo.                          |
| **Phased (recommended)**                         | In-repo first lets the shape stabilize, then publish | Two PRs across two repos. Two-month timeline.                                                     |

## Touch points (Phase 1)

1. `packages/clients/package.json` — new workspace with subpath exports.
2. `packages/clients/src/<vendor>/` — moved from `packages/cli/src/adapters/`.
3. `packages/cli/src/config.ts` — `Adapters` factory imports from `@rando/clients/*` instead of local `./adapters/`.
4. `packages/cli/src/adapters/` — directory removed.
5. `CLAUDE.md` — update the "future: centralize fetch" line to "see `tech-clients-monorepo.spec.md`."
6. `pnpm-workspace.yaml` — no change (already covers `packages/*`).

## What we accept

- **Phase 1 leaves `packages/api-client` untouched** for now. It's
  Rando-specific. Phase 2's `@theholocron/clients` org would have a
  separate "rando-api-client" package OR keep app clients in their
  own monorepo. Defer the call.
- **Test seams stay** — `packages/cli/src/__tests__/<vendor>.test.ts`
  files move alongside. Coverage thresholds re-pin.
- **Single source of truth for vendor types**. If the same vendor
  type leaked into multiple workspaces today (e.g. `VercelProject`),
  Phase 1 consolidates them in `@rando/clients/vercel`.

## What would make us reconsider

- **`@theholocron` deprioritized**. If the external monorepo never
  materializes, the work still pays off (in-repo clients package
  reduces import sprawl). No rollback needed.
- **A vendor adapter grows enough state that it doesn't fit the
  pure-fetch model** (e.g. heavy caching, retries with backoff,
  rate-limit awareness). At that point the adapter splits into
  `client/` + `service/` and only `client/` lives in the central
  package.

## Refs

- CLAUDE.md "Future: centralize fetch in a single `packages/clients`
  package" — superseded by this spec
- Related: `tech-api-testing-adapter.spec.md` (adapter pattern is the
  same shape used here)
