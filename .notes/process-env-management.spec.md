---
status: draft
issue: TBD
---

# `.env.example` as the source of truth + organized by tool

## Why

CLAUDE.md already documents: ".env.example is the per-context
contract. The keys an app declares in its .env.example determine
what gets synced from 1P locally AND what gets pushed to Vercel for
that app's deploy. No hardcoded variable lists."

Two gaps in today's setup:

1. **No tool grouping inside `.env.example`** — keys for Clerk,
   Vercel, Postman, 1P, GitHub, etc. all mix together. New
   contributors can't tell which key belongs to which tool, and
   removing a tool requires hunting individual entries.

2. **`.env.example` ↔ `.env` sync is half-built**. `rando secrets
sync` reads 1P and writes the local `.env`, but if you add a
   new entry to `.env.example`, nothing propagates: 1P might not
   have it, the env var is missing at runtime, and the orchestrator's
   "X declared but missing from 1P" notes are the only signal.

## Decision

### Part 1 — Tool-grouped `.env.example` format

Adopt a section-comment convention:

```bash
# ---------------------------------------------------------------------------
# Clerk (auth)
# ---------------------------------------------------------------------------
CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SIGNING_SECRET=

# ---------------------------------------------------------------------------
# Vercel (deploys)
# ---------------------------------------------------------------------------
VERCEL_TOKEN=
VERCEL_TEAM_ID=
VERCEL_AUTOMATION_BYPASS_SECRET=

# ---------------------------------------------------------------------------
# 1Password (vault)
# ---------------------------------------------------------------------------
OP_SERVICE_ACCOUNT_TOKEN=

# ---------------------------------------------------------------------------
# Neon (database)
# ---------------------------------------------------------------------------
NEON_API_KEY=
DATABASE_URL=
```

Same applies per-app: `apps/<name>/.env.example` keeps its own
grouped sections.

Each comment block becomes machine-readable too — `rando` parses
the section headings to know "these N keys belong to tool X." This
lets the CLI:

- Skip a whole tool's keys when an adapter is disabled
- Generate the per-tool environment-variable docs page
- Surface in `rando doctor` which keys belong to which tool

### Part 2 — `rando` handles env.example sync

New / extended subcommand: `rando secrets sync --check`

Walks `.env.example` (root + per-app), and for each declared key:

1. Verifies the key has a value in the configured 1P environment
2. Verifies the local `.env` has the value
3. Verifies (with `--push`) the value is pushed to Vercel's
   matching scope

Three outputs:

- `--check` (dry-run): table of missing-from-where
- `--write`: pull from 1P → `.env`
- `--push`: pull from 1P → Vercel env

Today, `rando infra setup` does the Vercel push as a side effect.
Splitting `secrets sync` out lets contributors run it standalone
without provisioning infra.

### Part 3 — `rando secrets doctor` (#220 already filed)

The discovery-side companion to `secrets sync`. Enumerates which
keys are declared-but-missing across all `.env.example` files vs
all configured secret stores (1P + Vercel + GH Environments if we
add them — see [[security-secrets-strategy]]).

Already filed as #220; spec lives here as the parent topic.

## Touch points

1. `.env.example` (root) — restructure into tool-grouped sections.
2. `apps/<name>/.env.example` (× 4) — same restructure.
3. `packages/cli/src/init/env-example.ts` — extend the parser to
   recognize section comments + return `{ section, keys }` tuples
   instead of a flat array.
4. `packages/cli/src/commands/secrets.ts` — extend `sync` with
   `--check`, `--write`, `--push` flags + grouped output.
5. `.github/CONTRIBUTING.md` — "Adding a new env var" section
   documents the section-comment convention + the sync command.
6. `MAINTAINING.md` — points operators at `rando secrets doctor`
   for env-drift triage.

## What we accept

- **Comments-as-config smell.** Section headings drive behavior
  (the parser reads them). Mitigation: documented format in
  CONTRIBUTING.md; bad heading = parser ignores section, with a
  clear note in `rando doctor` output.
- **Per-tool sections may overlap** (e.g. `DATABASE_URL` is "Neon"
  AND "Drizzle" depending on POV). Use the tool that PROVIDES the
  value, not the tool that consumes it.
- **`.env.example` becomes the authoritative list.** A var that
  isn't in `.env.example` and isn't read by code is dead — `rando
doctor` should flag.

## What would make us reconsider

- **Volume of env vars grows past ~50** — single `.env.example`
  becomes unwieldy. Split into `env-example.d/<tool>.env` files
  that `rando` concatenates.
- **A tool's keys span multiple categories** — section comment
  convention can't express "this key is Vercel-side but goes
  through 1P." Today everything is single-source, so deferred.

## Refs

- CLAUDE.md ".env.example is the per-context contract" — this
  spec operationalizes the rule
- [[security-secrets-strategy]] — secrets backend options
- #220 — rando secrets doctor (sibling impl)
