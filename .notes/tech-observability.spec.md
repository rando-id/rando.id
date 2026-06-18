---
status: approved # draft → proposed (issue filed) → approved (milestone attached)
issue: 41
---

# Observability — Sentry + Vercel logs + PostHog

## Decision

- **Sentry** for error tracking (server + client + native).
- **Vercel logs** for runtime + build logs (free, already there).
- **PostHog** for product analytics + session replay + feature flags.

`packages/observability` will provide thin wrappers; init isn't
wired into the apps yet (tracked at #41).

## Why

- **Sentry — best-in-class error tracking.** Stack traces, breadcrumbs, release tracking, source-map uploads. Cross-platform (Next.js + RN/Expo).
- **PostHog covers analytics + replay + flags in one tool.** Replaces a 3-tool stack (analytics, session replay, feature flags). OSS option means we could self-host later if pricing flips.
- **Vercel logs are free.** Don't replicate what we get for free.
- **Event names are already defined.** `packages/observability` has the taxonomy; we just haven't wired init yet.

## Options considered

- **Datadog** — does everything, expensive, overkill at our scale.
- **LogRocket** for session replay — proprietary, narrow.
- **Mixpanel / Amplitude** for analytics — costlier, no session replay, no flags.
- **Honeybadger / Rollbar** for errors — fine but Sentry has the lead.
- **Self-hosted Plausible + Sentry self-hosted** — costs us time we don't have pre-launch. Revisit at scale.

## What we accept

- **Three vendors.** Each has its own dashboard. Acceptable for the depth each provides.
- **Sentry costs scale with event volume.** Sample rates per env keep this manageable.
- **PostHog Cloud is the easy path; PostHog open-source is the escape hatch.** We use Cloud now, can self-host later if needed.
- **We haven't actually wired any of this yet.** The event names are defined but init isn't connected. This is a known gap (#41).

## What would make us reconsider

- One vendor adds a feature that obsoletes another (e.g. Sentry ships analytics that compete with PostHog).
- Pricing on any one flips bad enough to justify a switch.
- Self-hosting PostHog OSS becomes attractive (small Hetzner box could handle our scale for a long time).
