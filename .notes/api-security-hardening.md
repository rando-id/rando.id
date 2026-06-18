# API security hardening

Pulled from PR #62 (Devin), which conflicts with main on the workflow
files we deleted during the CI reorg. Cherry-picking the API/middleware
pieces by hand instead of rebasing the branch.

## What's being applied

### CORS — middleware.ts

`corsHeadersFor()` currently falls back to `ALLOWED_ORIGINS[0]` for
unrecognized origins, which means an attacker can hit any endpoint
from any origin and get a usable `Access-Control-Allow-*` response
(echoing the first whitelisted origin back). Subtle but real.

Fix: return only `Vary: Origin` when the origin doesn't match a
whitelisted one. The browser blocks the response. Whitelisted origins
get the full set as before.

### UUID validation — new `validate-uuid.ts` helper + 4 route guards

All `[id]` / `[contactId]` route handlers currently pass the raw path
param straight to Postgres. A non-UUID string triggers a raw Postgres
cast error (`invalid input syntax for type uuid`), which:

1. Leaks the column type in the error response (light schema leak)
2. 500s instead of 404s (uglier UX)

Fix: a tiny `isUuid()` helper validates the format before hitting the
DB. Non-UUID → 404 immediately.

Touched routes:

- `/v1/contacts/[id]` (GET, PATCH)
- `/v1/lists/[id]` (GET, PATCH, DELETE)
- `/v1/lists/[id]/members` (POST)
- `/v1/lists/[id]/members/[contactId]` (DELETE — validates both ids)

### Security headers — Next.js `next.config.ts` per app

All three Next.js apps return:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(...)` —
  empty for api + admin (no browser features used);
  `geolocation=(self)` for web (the contacts feature uses it).

## What's being dropped from PR #62

- **Workflow file edits** (`.github/workflows/{ci,issues-sync,preview}.yml`) — all three files no longer exist; the CI reorg replaced them with lint/typecheck/unit-tests/deploy/issues/integration-tests.
- **`packages/api-client/package.json` zod add** — already shipped (commit b3b82675).
- **pnpm-lock changes** — will regenerate on `pnpm install`.

## Decision

Apply the security hardening pieces directly on main as a fresh commit.
Close PR #62 with a reference to the new commit.
