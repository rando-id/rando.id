---
status: approved # draft → proposed (issue filed) → approved (milestone attached)
issue: TBD
---

# MCP servers

## Background

[`nuxt-mcp`](https://github.com/antfu/nuxt-mcp) is a **community module**
(antfu's), not first-party. It introspects a Nuxt app's
routes/pages/components and exposes them to AI assistants via MCP.
Installed via `npm i nuxt-mcp`.

**Next.js isn't from the same company as Nuxt** — Next is Vercel; Nuxt
is NuxtLabs/community. No first-party Next.js MCP exists today.
Vercel-adjacent options:

- **Vercel MCP** (official, by Vercel) — manages deploys, env vars, projects via MCP. Overlaps with what `rando deploy` already does.
- **v0 MCP** (Vercel) — for v0 code generation. Less relevant.
- **Community Next.js MCPs** — varying quality, mostly route/component introspection.

## MCPs evaluated for Rando

| MCP                        | What it does                             | Worth it?                                             |
| -------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| **Vercel MCP** (official)  | Manage projects, env vars, deploys       | Yes — covers cross-account ops `rando deploy` doesn't |
| **Neon MCP** (official)    | Query/manage Neon DBs from the assistant | Yes — replaces hand-running SQL when debugging        |
| **Clerk MCP** (official)   | Inspect users, sessions, orgs            | Yes — useful for auth debugging                       |
| **Sentry MCP** (official)  | Pull recent errors, breadcrumbs          | Wire when Sentry is live                              |
| **PostHog MCP** (official) | Query events, funnels                    | Wire when PostHog is live                             |
| **GitHub MCP**             | gh ops via MCP                           | Low value — Claude Code already uses `gh` CLI         |

## Should we MCP-ify our own API?

**No.** MCP is for capabilities an AI agent should invoke.
`/v1/contacts` is a CRUD API for end users — wrapping it as MCP is a
demo with low practical value vs. maintaining two surfaces.

**Narrower case worth tracking:** a `rando-admin-mcp` for dev/admin
tooling — "create test users, reset staging to a known fixture, run a
seed scenario." Parallel surface that wraps `rando` CLI commands, not
the public API. Filed as a separate ticket; build later when toil
justifies it.

## Where MCP config lives

`.mcp.json` at the repo root. Project-scoped — anyone who clones the
repo gets the same setup.

**Actual auth model varies by server:**

- **Vercel MCP** is remote (`https://mcp.vercel.com`) with OAuth — first connect triggers a browser flow, token cached by Claude Code locally per-user. Not stored in the repo.
- **Clerk MCP** is remote (`https://mcp.clerk.com/mcp`) with **no auth** — it's a docs/SDK guidance server, not a user-data server. (For per-instance user inspection we'd still use `rando clerk users …` or the Clerk CLI.)
- **Neon MCP** is a local `npx -y @neondatabase/mcp-server-neon start <key>` process. The key is read from `${NEON_API_KEY}` in the calling shell's env, which `rando secrets sync` populates into `.env`. **Caveat:** Claude Code itself doesn't auto-load `.env` — you need to either `source .env` before running `claude`, or set up direnv to auto-export when entering the directory.

## Decision

Wire **Vercel + Neon + Clerk MCPs**. File a follow-up ticket for
`rando-admin-mcp`. Skip Sentry/PostHog until those services are
actually wired into the apps.

## Status

- ✅ `.mcp.json` committed with all three servers
- ✅ Follow-up ticket filed for `rando-admin-mcp`
- ⏳ Next time you run `claude` in this directory: first session prompts you to authorize Vercel via OAuth; Neon needs `NEON_API_KEY` exported in the shell (either `source .env` or direnv).
