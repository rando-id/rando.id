---
status: approved # draft → proposed (issue filed) → approved (milestone attached)
issue: TBD
---

# Clerk — auth

## Decision

Clerk (with the `@clerk/nextjs` + `@clerk/clerk-expo` SDKs) for auth
across all three Next apps and the native app. Webhooks sync the
Clerk user record into the local `users` table on every
`user.created` / `user.updated` / `user.deleted` event.

## Why

- **Drop-in components.** `<SignIn />`, `<SignUp />`, `<UserButton />`, organizations, MFA — pre-built and theme-able. Saves weeks of UI work.
- **Cross-platform SDKs.** Same auth on web (`@clerk/nextjs`) + native (`@clerk/clerk-expo`) with consistent session model. Critical for the monorepo.
- **Webhook → DB sync is a well-trodden pattern.** Svix-signed webhooks; we own the local `users` table and join it everywhere.
- **Pre-built admin tooling.** Clerk dashboard handles user management, banning, impersonation — features we'd otherwise need to build.

## Options considered

- **Supabase Auth** — would couple us to Supabase as the database provider (we picked Neon for PostGIS quality reasons; see tech-neon-postgres.md). Decoupling auth from DB lets us pick best-in-class.
- **Auth.js (NextAuth)** — OSS, free, very flexible. Tradeoff: we'd own the UI, the email provider integration, the MFA story, the org primitives. ~weeks of work we'd rather not do pre-launch.
- **Firebase Auth** — would pull in the rest of Firebase, and the React Native SDK story is weaker than Clerk's.
- **Roll our own (JWT + bcrypt + Postgres)** — pre-launch, defensible. As soon as we need OAuth / passkeys / MFA / orgs we're rebuilding what Clerk gives us.

## What we accept

- **Vendor lock for the auth user-store.** If we leave Clerk we have to either keep paying for the data or rebuild OAuth flows + email infra. Acceptable cost for the time saved.
- **Pricing past free tier.** Free covers ~10K MAU. We'll pay above that, which is fine as long as the product also makes money.
- **Webhook sync is eventually-consistent.** A user created in Clerk reaches our DB ~milliseconds later, but the lag is real. We handle "user not yet in DB" gracefully in the API.
- **Two Clerk instances** (Development + Production) means two webhook endpoints per deploy environment. Configured by `rando clerk webhook setup`.

## What would make us reconsider

- Clerk pricing flips bad at scale we can't avoid.
- We need a feature Clerk doesn't have and won't add (rare — they ship fast).
- **Neon Auth ships GA and the architectural cleanness (auth-data-IS-Postgres) outweighs Clerk's UI/feature lead.** Tracked in follow-up issue #85. See below for what a migration would actually look like.

### Neon Auth migration sketch

Reference doc: <https://neon.com/docs/auth/quick-start/nextjs-api-only>
— Neon's "API-only" quick-start (no SDK lock-in; we drive it via REST
from our existing Hono / Next API routes). The other Neon Auth
quick-starts pull in Stack Auth's React SDK; the API-only path is the
right anchor for a Clerk migration because it lets us keep our own
auth UI (or build a minimal one) instead of swapping one SaaS UI for
another.

What a migration would touch:

1. **Provisioning** — `rando vc setup` would gain a `neon-auth` step (or extend `rando db ...`) that enables Neon Auth on the project, writes `NEON_AUTH_PROJECT_ID` / `NEON_AUTH_SECRET_KEY` into the local `.env` and Vercel env. The Neon side has its own REST API for this (covered in the quick-start).
2. **Schema** — Neon Auth writes user records directly into a Postgres schema on our DB (the architectural win — no webhook sync, no eventual consistency, JOINs across `users` work natively). Drizzle schema in `packages/db` adds a `neon_auth.users_sync` source view; our existing `users` table becomes a thin extension of it.
3. **API** — Clerk's `@clerk/nextjs` middleware → a thin JWT verify middleware against Neon Auth's JWKS endpoint. The session model is similar enough that the per-route guards barely change.
4. **Native** — the biggest open question. Neon Auth's quick-starts are web-first; native flow is "use Stack Auth's Expo SDK" or roll a custom OAuth + JWT exchange. Until we have a concrete answer here, the migration story is incomplete.
5. **Decommission** — webhook endpoints, Clerk env vars, `@clerk/*` deps all come out. `rando clerk webhook setup` → deleted.

Until #85's "is Neon Auth GA + does it cover native" question resolves to yes/yes, the right move is to stay on Clerk and link from there.
