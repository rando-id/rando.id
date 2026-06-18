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
- Neon Auth ships GA and the architectural cleanness (auth-data-IS-Postgres) outweighs Clerk's UI/feature lead. Tracked in follow-up issue #85.
- We need a feature Clerk doesn't have and won't add (rare — they ship fast).
