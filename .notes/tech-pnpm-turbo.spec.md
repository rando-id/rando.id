---
status: approved # draft → proposed (issue filed) → approved (milestone attached)
issue: TBD
---

# pnpm + Turborepo — monorepo tooling

## Decision

pnpm for the package manager, Turborepo for the task graph + caching.
Workspace layout under `apps/*` (deployable) and `packages/*`
(shared libraries) + `tooling/*` (configs).

## Why

- **pnpm for the install model.** Strict by default (no phantom deps), content-addressable store (fast + disk-efficient), workspace protocol (`workspace:*`) keeps internal links honest. The hoisting model is sane out of the box; npm + yarn classic both have foot-guns.
- **Turborepo for the task graph.** `pnpm test` becomes `turbo run test` which only re-runs affected packages thanks to content-hash caching. CI workflows already lean on this for change detection (`.github/actions/changes` uses `turbo run ... --filter='...[base]'` to compute affected workspaces).
- **One source of truth for the dep graph.** Each package's `package.json` declares its `@rando/*` siblings; Turbo + Dependabot both read from it.
- **Vercel auto-detects both.** No `vercel.json` needed for monorepo concerns.

## Options considered

- **Nx** — heavier, more opinionated, code-generators-first. Powerful but more than we need for 15-ish workspaces. Nx's task graph + caching are similar to Turbo's; the cost is buying into the Nx world.
- **Yarn 4 (Berry) workspaces** — works fine, but PnP mode is divisive and the non-PnP mode loses pnpm's strictness. No compelling pull.
- **npm workspaces** — newer, less mature, no decent task runner equivalent to Turbo.
- **Rush** — more enterprise-flavored, more setup ceremony, less velocity.

## What we accept

- **Turbo's remote cache is paid above the free tier.** Vercel-hosted projects get it free; we use it.
- **pnpm has gotchas with peer deps on workspace packages.** The Drizzle dedup issue in CLAUDE.md is a direct consequence — we have to enforce "import via `@rando/db`" by convention.
- **Adding a workspace is two files + a Turborepo cache invalidation.** Real friction, not enormous.

## What would make us reconsider

- A specific killer feature lands in Nx that we'd actually use (e.g., really compelling code-generators for our pattern of new-vendor-adapters).
- Turbo's caching model changes in a way that hurts us.
- We outgrow the workspace model entirely and need polyrepo (the trigger would be very different teams owning very different apps — unlikely for a long while).
