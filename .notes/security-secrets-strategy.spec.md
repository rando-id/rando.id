---
status: draft
issue: TBD
---

# Secrets strategy — 1Password vs GitHub Environments

## Why

Today's secrets backend is 1Password Environments
([[security-github-pat.md]]), fronted by `OP_SERVICE_ACCOUNT_TOKEN`
in GitHub repo secrets. The pattern works but has friction the user
flagged:

- Every workflow needs `op` CLI installed + bootstrap call
- The SA token is the single bootstrap key — losing or rotating it
  is high-blast-radius
- Vercel has native GitHub Environment integration; 1P doesn't
- New apps adopting this template inherit 1P-specific machinery

User asked to "swap out 1P for environment control for github" — but
also wants pros / cons of multiple interpretations weighed. This
spec captures the options without locking in.

## Options under consideration

### Option A — Stop using 1P entirely; secrets live in GH Environment secrets

Secrets move to GitHub Environments (`production`, `staging`,
`preview`). Workflows read via standard `secrets.SECRET_NAME`. Vercel
pulls from GH Environments via its native integration. `op` CLI
drops out of every workflow.

| Pros                                                                               | Cons                                                                                            |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Removes `OP_SERVICE_ACCOUNT_TOKEN` bootstrap entirely                              | Loses 1P's human-friendly UI for managing secrets                                               |
| Workflows run faster (no `op` install + bootstrap)                                 | GH Environment secrets are NOT readable via UI (write-only) — operators must re-enter to verify |
| One vendor (GitHub) instead of two for CI secrets                                  | No secret-versioning / audit-log in GH like 1P has                                              |
| Standard pattern — every Rando-template app gets this for free                     | Migration is one-shot: every secret needs to be re-entered in GH once                           |
| Native Vercel integration — Vercel project pulls from GH Environment automatically | Local dev secrets still need a vault somewhere; `.env` files become more important              |

### Option B — Keep 1P as human vault, sync to GH Environment via API

`rando secrets push` reads from 1P → writes to GH Environment via
GH REST API. Workflows read from GH Environment normally. 1P stays
as the human-facing vault for editing.

| Pros                                                                                                   | Cons                                                                                              |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Best of both — 1P UX + GH Environment runtime                                                          | Two systems to keep in sync (drift risk)                                                          |
| Workflows don't need `op` CLI anymore                                                                  | `rando secrets push` becomes the only way to write secrets — if humans edit GH UI directly, drift |
| Audit log + versioning preserved in 1P                                                                 | API complexity — need to encrypt secrets via libsodium before pushing (GH requirement)            |
| Migration is incremental — `rando secrets push` already works on Vercel; extending to GH is mechanical | Sync cadence: cron job? push on every CI run?                                                     |

### Option C — Use GH API to manage 1P environments (reverse)

Less likely interpretation, but flagging: GH-side automation drives
1P environment creation / membership via 1P's API. CI in GH could
provision 1P containers per-environment.

| Pros                                                 | Cons                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| Lets `rando setup gh` (#222) configure 1P scopes too | 1P's API doesn't fully support this (environment creation via API is limited) |
| One-way sync (CI side) is simpler than two-way       | Solves a different problem than the others — doesn't reduce runtime CI work   |
|                                                      | This is "use GH to script 1P" — backwards from what the user probably meant   |

### Option D — Status quo (1P + `op` CLI in every workflow)

| Pros                | Cons                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Zero migration work | Current friction stays                                                                           |
| Audit log + UI good | `OP_SERVICE_ACCOUNT_TOKEN` bootstrap is the failure mode that bit us multiple times (#212, #217) |

## Comparison matrix

| Capability                | A (GH only)        | B (1P → GH sync)                           | C (GH → 1P)          | D (status quo)  |
| ------------------------- | ------------------ | ------------------------------------------ | -------------------- | --------------- |
| Human-editable secrets UI | ❌ (GH write-only) | ✅ (1P)                                    | ✅ (1P)              | ✅ (1P)         |
| Audit log                 | ❌                 | ✅                                         | ✅                   | ✅              |
| CI runtime simplicity     | ✅ (no `op`)       | ✅ (no `op`)                               | ❌ (still need `op`) | ❌              |
| Vercel integration        | ✅ native          | ✅ native                                  | ❌                   | ❌ (rando push) |
| Bootstrap surface         | minimal            | 1 token                                    | 2 tokens             | 1 token         |
| Sync drift risk           | ✅ no sync         | ⚠ requires `rando secrets push` discipline | ⚠                    | ✅ no sync      |
| Migration cost            | Highest            | Medium                                     | Low                  | Zero            |

## Recommendation (for discussion)

**Option B** is the strongest middle ground:

- Keeps the 1P UX humans like
- Removes the `op` CLI from every workflow (workflows just read GH secrets)
- Vercel integration becomes native through GH Environments
- `rando secrets push` is one more code path on top of the existing
  Vercel-push logic; not a new system

The drift risk is the main cost. Mitigation: pre-commit hook OR a
nightly cron that compares 1P state against GH Environment state and
opens a PR if drift detected.

**Option A** is the simplest long-term shape but loses too much
operator UX. Most teams that drop 1P also stop using a managed
vault entirely, and Rando's solo-flow makes this fine — but the
audit log is genuinely useful.

**Option C** is probably what the user did NOT mean.

**Option D** is the no-op.

## Open questions

1. **How often does the user manually inspect 1P environments?** If
   rarely, A is fine. If frequently, B is the better fit.
2. **What's the cost of operator re-entering secrets in GH UI for
   the one-shot migration in Option A?** Counts of secrets per
   environment matter.
3. **Does GH Environment's per-secret access logging satisfy the
   audit-log requirement?** If yes, A becomes much more attractive.

## Touch points (Option A or B)

Both options touch:

1. `packages/cli/src/adapters/<new>.ts` — new GH Environment adapter
   for `rando secrets push` (extends the existing pattern)
2. `packages/cli/src/commands/secrets.ts` — extend `push` with
   `--to gh-env`
3. `.github/workflows/*.yml` — remove `op-env` action invocation;
   workflows read `secrets.X` directly
4. `.github/actions/op-env/` — deprecate (Option A) or keep for
   local-vault-read use cases (Option B)
5. `CONTRIBUTING.md` — re-document the secrets flow under chosen option

## What we accept

- **Vendor lock-in to GitHub for runtime secrets.** Option A makes
  GH the only secrets-runtime path. Acceptable since CI is GH
  Actions anyway; if we ever move CI, this changes.
- **Migration is real work.** Even Option B's incremental shape
  needs an initial sync pass.

## What would make us reconsider

- **GitHub Actions or GH Environments has a serious outage** that
  takes down our deploys. The 1P-only fallback would have been
  useful. Mitigation: keep 1P populated for ~6 months after the
  switch so the rollback is "swap back to op-env."
- **A new secrets vendor (Vault, Doppler) emerges as compelling.**
  Either option above still adapts cleanly via the existing
  `domain/secrets.ts` interface.

## Refs

- `security-github-pat.md` — existing PAT setup that this restructures
- #217 — `op-env` foot-gun (the env-id default that bit prod)
- `process-env-management.spec.md` — sibling (env.example as source of truth)
- #220 — `rando secrets doctor`
- #222 — `rando setup gh` (would provision GH Environments either way)
