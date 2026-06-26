---
status: proposed
issue: 239
---

# MSW expansion — shared handlers across test layers

## Why

MSW is already a dep in `packages/testing` (one workspace touchpoint),
but it's underused. The natural roles for MSW in this repo:

- **Unit tests**: mock fetch in component / hook tests so they
  don't need a real API
- **Storybook**: mock fetch in stories (loading / error / success
  variants without server)
- **Playwright** (Phase 2): intercept network at the browser layer
  for deterministic E2E
- **`apps/web` dev mode**: optionally intercept in the dev server
  for offline / contract-mismatched testing

Today, only the first slice is partially wired. Centralizing the
handler set in `packages/testing` and consuming from all four
contexts is the unifying change.

## Decision

`packages/testing/src/msw/` owns the canonical handler set, derived
from the OpenAPI contract:

```
packages/testing/src/msw/
├── handlers/
│   ├── contacts.ts       # /contacts GET/POST/PATCH/DELETE
│   ├── lists.ts          # /lists GET/POST/...
│   ├── auth.ts           # Clerk webhook receivers
│   └── index.ts          # re-exports
├── fixtures/
│   ├── contacts.ts       # factory functions: aContact(), aContactList()
│   └── lists.ts
├── node.ts               # setupServer() for vitest
├── worker.ts             # setupWorker() for browser
└── index.ts
```

Each consumer pulls from one entry point:

- **Vitest setup**: `import { server } from '@rando/testing/msw/node'`
- **Storybook**: `import { handlers } from '@rando/testing/msw/handlers'`
- **Playwright** (when added): inject via page.route() from same handlers
- **`apps/web` dev mode**: `if (process.env.RANDO_MSW) await worker.start()`

## OpenAPI-derived handlers

Today the API contract lives in `apps/api/openapi.json`. MSW handlers
should be derivable from it — same source of truth means they can't
drift. Two approaches:

| Approach                                                          | Pros                                           | Cons                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| **Hand-author handlers**, lint against contract                   | Full control over response shapes, error cases | Drift risk; need a contract-conformance test                                   |
| **Generate handlers from OpenAPI** via `msw-auto-mock` or similar | Zero drift by construction                     | Generated mocks are dumb (random data); hard to express "loading state for 2s" |

**Recommend hybrid**: hand-authored handlers for the cases tests
actually need; a contract-conformance test (using existing
`@rando/api-client/contract.ts` types) that verifies handlers
respond with valid schema shapes.

## Touch points

1. `packages/testing/src/msw/` — new directory structure above.
2. `packages/testing/package.json` — already has msw dep. Add
   `setupServer` / `setupWorker` exports via subpath
   (`@rando/testing/msw/node` + `/msw/worker`).
3. `apps/web/src/lib/__tests__/` — existing tests migrate to use the
   shared `server`.
4. `apps/web/src/mocks/browser.ts` (new) — optional dev-mode worker
   setup gated on `RANDO_MSW=1`.
5. `tooling/storybook/.storybook/preview.ts` — register MSW addon +
   default handlers.
6. `packages/testing/src/msw/__tests__/contract.test.ts` — new
   test that runs every handler's response through the OpenAPI
   contract validator.

## What we accept

- **Handler maintenance**. Every API change requires an MSW handler
  update OR a generator regen. Contract test catches drift fast.
- **Multiple MSW versions risk**. With MSW in catalog and consumers
  importing from `@rando/testing`, version pin is one place.
- **Browser bundle size in dev mode** — MSW's worker is ~50KB
  gzipped. Acceptable for dev, off by default in production builds
  (env-gated).

## What would make us reconsider

- **OpenAPI generation matures** (e.g. `openapi-msw` becomes
  production-quality). At that point, drop the hand-authored
  handlers in favor of generated ones + the contract test as the
  only check.
- **Contract test catches drift too late** (only on PRs that touch
  testing). Move it to `packages/api/postinstall` or a Husky hook
  so OpenAPI edits in `apps/api` fail loudly.

## Refs

- `tech-storybook.spec.md` — consumer
- `tech-playwright.spec.md` — Phase 2 consumer
- `tech-api-rest-openapi.spec.md` — contract source of truth
- `packages/testing` — current home; this spec expands it
