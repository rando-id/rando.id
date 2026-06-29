---
status: approved # draft → proposed (issue filed) → approved (milestone attached)
issue: 277
---

# Vercel — hosting

## Decision

Vercel as the hosting target for the three Next.js apps
(`apps/web`, `apps/admin`, `apps/api`). Deploys via Vercel's
native GitHub integration: push to `main` → prod, push to
`staging` → staging, PRs → preview URLs.

## Why

- **Push-to-deploy with zero YAML.** GitHub integration, auto-detects Next.js, builds + ships. PR preview URLs are free.
- **Stable preview URLs via the orchestrator.** `rando deploy branch --stable-url` builds `<branch-slug>-<app>.rando-id.dev` so we can run integration tests + share previews on predictable URLs.
- **Marketplace integrations.** Neon (DB), Upstash (Redis), Vercel Blob (storage) — all one-click. The infra orchestration our CLI does is mostly stitching these together.
- **Next.js features just work.** ISR, image optimization, edge functions, RSC, app router middleware — first-party tuned.
- **Solo-dev velocity.** No "how do I configure the deploy pipeline" tax.

## Options considered

- **Cloudflare Pages / Workers** — cheaper, edge-native. Next.js support exists but with footguns; some features (image optimization, ISR) work differently or not at all. Worth revisiting if we'd otherwise outgrow Vercel pricing.
- **Netlify** — close to Vercel, slightly behind on Next.js parity (lag of weeks-to-months on each major release). Not worth switching.
- **Railway / Render / Fly.io** — would mean running Next.js as a container, losing the serverless model. Could make sense for `apps/api` if we hit Vercel limits.
- **AWS (ECS / Lambda) + custom CI** — total control, total maintenance burden.

## What we accept

- **Vercel lock-in is real.** Next.js features are tuned for Vercel; pulling out means losing some or running our own infra to replicate them. The decision to accept this is documented in MAINTAINING.md → Deploy strategy.
- **Free tier limits.** Build minutes, function execution, bandwidth all metered. We'll pay above free at some point — fine if the product earns it.
- **Hobby plan requires public repos for free.** Rando.id is public for this reason (PolyForm Noncommercial license still applies). Documented earlier in the project history.

## What would make us reconsider

- Vercel pricing flips bad before we're earning enough from the product → migrate `apps/api` first (lowest friction, no RSC/ISR), keep web + admin on Vercel until cost forces full move.
- We need long-running workloads (websockets, background workers > 10min) → run those somewhere else and let them speak the OpenAPI contract.
- Vercel makes a product / policy decision we can't accept (very rare).
