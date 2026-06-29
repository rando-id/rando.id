---
status: approved # draft → proposed (issue filed) → approved (milestone attached)
issue: 274
---

# Next.js (App Router) — web, admin, api

## Decision

Next.js 15 App Router for `apps/web`, `apps/admin`, and `apps/api`.
All three deploy as separate Vercel projects.

## Why

- **Vercel-native deploys.** Push-to-deploy with zero YAML. Per-PR preview URLs for free. Build-minute economics tied to one vendor we already chose for hosting.
- **App Router + RSC.** Server components for the contacts list (mostly server-rendered, hydration only for the geolocation-driven re-sort). Reduces client JS noticeably vs. Pages Router.
- **One framework for three surfaces.** `apps/api` is a Next.js app whose only purpose is `/v1/*` route handlers. Costs us nothing vs running Hono / Fastify standalone, and we get the same dev tooling + middleware story as the user-facing apps.
- **Familiarity tax minimized.** Everyone hiring or contributing already knows it.

## Options considered

- **Remix / React Router v7** — closer to web fundamentals, but PR-time pain on Vercel (less native), no first-class App Router-equivalent RSC story for our scale, and the Next.js community size matters for AI-tooling quality.
- **SvelteKit / Astro** — would mean abandoning React shared with `apps/native` (Tamagui-on-RN). Cross-platform component reuse is the whole point of the monorepo.
- **Vite + Vanilla React** — works fine but we lose route-level streaming, server components, native middleware, image optimization, and the deploy story.

## What we accept

- **Vercel lock-in.** Some Next.js features (ISR, image optimization, edge functions, draft mode) work elsewhere but tuned for Vercel. See `tech-vercel.md` for the broader lock-in conversation.
- **App Router churn.** Best practices have shifted ~quarterly through Next 13/14/15. We accept the cost of re-learning when we bump majors.
- **Three projects to maintain.** Each app has its own `next.config.ts`, env vars, Vercel project. The shared bits live in `packages/*`. Worth the duplication for clear blast radius.

## What would make us reconsider

- Vercel pricing becomes painful at scale → look at Cloudflare Pages / Workers (which Next.js technically supports but with caveats).
- App Router shipped a hard breaking change we can't follow → ELI the rewrite cost vs jumping ship.
- We need server-side capabilities Vercel can't host (long-running connections, websockets at scale) → split `apps/api` onto Fly.io or similar and let it speak the same OpenAPI contract.
