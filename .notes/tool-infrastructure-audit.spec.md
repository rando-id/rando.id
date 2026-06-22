---
status: proposed # draft → proposed (issue filed) → approved (milestone attached)
issue: 173
---

# `rando infrastructure audit` — detect drift between cloud state and rando.config.json

## Decision

Add a new `rando infrastructure audit` subcommand that compares the **live state** of cloud providers (Vercel, Cloudflare DNS, Neon, 1Password — in that order of priority) against the **declared state** in `rando.config.json` and reports drift. Run it locally on demand AND nightly in CI (post a warning if drift is detected, don't fail the run).

Initial scope: **Vercel projects** — list every project the team owns, diff against `rando.config.json`'s `apps[].name`, flag:

- **Orphan projects** — exist in Vercel, not in config (e.g. the `rando-id` project that triggered this work — auto-created when someone clicked "Import Git Repository" in the Vercel UI, never cleaned up)
- **Root Directory mismatches** — config says `apps/<name>`, project says `.` or wrong path
- **Missing projects** — config declares an app, no matching Vercel project exists

Future expansion: same audit pattern for Cloudflare DNS records (declared via `rando dns`), Neon branches (declared via `rando db`), and 1Password Environments (declared in the `.env.example` contract).

## Why

- **The `rando-id` orphan sat there for months silently failing every PR's deploy check.** It was harmless (no domains assigned, no traffic) but noisy — every PR comment thread got an extra red Vercel check. The CLI's `setup` command creates projects from config but never reads the reverse direction; nothing surfaced the drift.
- **Drift between cloud state and config is the recurring failure mode in this stack.** `rando infrastructure setup` is the forward path (config → cloud). The reverse path (cloud → config-diff) doesn't exist. Every time a manual Vercel/Cloudflare/Neon click bypasses the CLI, drift accumulates silently.
- **One pattern, many providers.** The audit logic is the same across providers — list live entities, diff by name against config, classify by category. The Vercel-first slice proves the pattern; subsequent providers slot in as additional steps in the same command.
- **Cheap to ship, big quality-of-life win.** The Vercel adapter already has `listProjects` (used by `setup`). Audit is a few hundred lines of diff + reporting on top of existing surface.

## Options considered

- **Status quo: do nothing.** Cost: orphans accumulate, every PR gets noisy red checks, debugging "why is this build failing" wastes time. Doesn't compound — every new provider integration adds another drift surface with no detector.
- **Detect drift on `rando infrastructure setup` directly** instead of a separate command. Cost: `setup` is already complex (~250+ lines), adding cross-provider diff logic inline makes it harder to reason about. Setup is forward-only by design; audit is a different intent. Keep them separate.
- **Auto-cleanup in setup** — `setup` deletes orphans it finds. Hard pass. Cloud-side deletion is a one-way door; "I forgot to add this to config" is a much more common failure mode than "I forgot to delete this from cloud". Audit reports, doesn't act.
- **Write a generic "cloud-state-diff" framework first** — generalize over providers via an adapter interface. Premature. Ship the Vercel slice, learn what the actual abstraction needs, then generalize on the second provider.
- **Use a third-party tool (Terraform / Pulumi / etc.).** Massively over-scoped — we'd lose the "everything goes through `rando`" stance for one drift detector. Revisit if the cloud surface keeps growing.

## What we accept

- **Audit reports, doesn't fix.** No `--apply` flag. The output points at the Vercel UI URL (or equivalent) and tells the human what to delete / update. Auto-fix is a separate decision that should require its own opt-in.
- **`infrastructure setup` doesn't gain a new responsibility.** It stays the forward path. Audit is purely diagnostic.
- **CI runs the audit on a schedule, not on every PR.** Drift detection is a low-frequency concern; we don't need to gate merges on it. Nightly cron + an `info`-level GitHub issue comment when drift is detected matches what we'd actually act on.
- **Vercel adapter gets one new method (`listProjects` for the team scope).** The existing `listProjects` is `apps[].name`-scoped; the audit needs an unfiltered team-wide list. Same surface, just one more call.
- **No new dep.** Pure additive logic in `packages/cli`.

## What would make us reconsider

- A drift class shows up that isn't captureable as "list cloud entities, diff against config" (e.g. environment-variable values, secret rotation state). Then this command's scope is wrong and we'd want a different shape.
- Vercel ships their own "audit" surface in their CLI / dashboard that does the same thing. Then we just point at it from docs and stop maintaining this.
- The `rando` CLI's scope shrinks (someone migrates to Terraform). Then audit becomes Terraform plan output, no custom code.

## Implementation sketch

1. **Domain** — add to `packages/cli/src/domain/deploy.ts`:

   ```ts
   listAllProjects(): Promise<VercelProject[]>  // team-scoped, no apps[] filter
   ```

   `VercelProject` includes `name`, `rootDirectory`, `id`, `link` (git source), `createdAt`. Most of these are already returned by the existing single-project getter — just need the list variant.

2. **Adapter** — `VercelRestProvider.listAllProjects()` calls `GET /v9/projects?teamId=<id>&limit=100` (paginates).

3. **Command** — `packages/cli/src/commands/infrastructure.ts` gains:

   ```bash
   rando infrastructure audit                  # all checks
   rando infrastructure audit --provider vercel # scope to one provider
   rando infrastructure audit --json            # machine-readable for CI
   ```

   Logic per provider:
   - List live entities
   - Map config entities (e.g. `apps[].name` → expected Vercel project name conventions)
   - Classify each live entity: `expected` / `orphan` / `mismatch`
   - Each config entity: `expected` / `missing`
   - Emit human or JSON report

4. **CI workflow** — new `.github/workflows/infrastructure-audit.yml`:
   - Trigger: cron nightly (or weekly) + `workflow_dispatch`
   - Run `rando infrastructure audit --json` with the staging `op-env` (for the cloud credentials)
   - If drift detected, post a comment on a tracking issue (or open one if none exists). NOT a PR comment — drift is repo-wide, not per-PR.

5. **Docs** — extend `.github/MAINTAINING.md` "Deploy strategy" section to mention the audit as the recommended way to spot drift before it bites.

## Open questions

- **What's the right tracking issue model for nightly drift?** Single long-lived issue that gets a new comment per drift event, vs. open a fresh issue each time? Lean toward single long-lived issue with a known label (`infra-drift`) so notifications stay manageable.
- **Should the Vercel "name → expected app" matcher be lenient or strict?** A project named `rando-staging-api` could be a legitimate naming variant or an orphan — we'd need a heuristic. Lean strict (exact match against `apps[].name` derivative) and treat anything else as orphan + leave the verdict to the human.
- **DNS audit later — what's the source of truth?** `rando dns` doesn't track records in `rando.config.json` today; declared state lives partly in the apps' deploy logic. May need a `dns:` block in the config before DNS audit becomes meaningful.
