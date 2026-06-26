# CLAUDE.md

Conventions for working on Rando. Loaded automatically by Claude Code into every conversation.

## Code patterns

- **Adapter pattern for any 3rd-party service.** `domain/X.ts` (interface) + `adapters/X.ts` (impl) + register in the `Adapters` factory in `packages/cli/src/config.ts`. Applies to vendor APIs/CLIs (Vercel, Neon, Clerk, 1P, GitHub, Postman). Skip for pure utility libs (zod, lodash) where the swap risk is essentially zero.
- **Soft-skip over hard-fail when a dependency is missing or optional.** The orchestrator never blocks on auth issues, missing `.env.example`, or missing 1P keys — it emits a note and continues so the rest of the pipeline still runs.
- **Idempotent orchestrator steps.** Check-then-create, treat "already exists" / 409 as success, never blow up on re-runs.
- **`.env.example` is the per-context contract.** The keys an app declares in its `.env.example` determine what gets synced from 1P locally AND what gets pushed to Vercel for that app's deploy. No hardcoded variable lists.
- **Future: centralize fetch in a single `packages/clients` package.** Not built yet — direction only. Today's `packages/cli/src/adapters/*` and `packages/api-client/*` should converge there. See `.notes/tech-clients-monorepo.spec.md` for the phased plan (in-repo first, then extract to `@theholocron/clients-*`). When writing new fetch code, ask whether it belongs in the central package first; if you build it elsewhere, leave a comment noting the eventual move.

## Workflow

- **Commit messages → pasteboard.** When the user asks for one, draft it and pipe to `pbcopy`, then announce in one sentence. Don't paste the message into the conversation.
- **Discuss → `.notes/<topic>.spec.md` → GitHub issue.** Non-trivial decisions (library choice, approach, infra option) get captured in `.notes/<topic-kebab-case>.spec.md` BEFORE acting. **One topic per file** — if a thread covers multiple decisions, split them. Files in `.notes/` use a category prefix:
  - `tech-` — vendor / library / framework choice (e.g. `tech-clerk.spec.md`)
  - `tool-` — developer / AI / automation tooling (e.g. `tool-mcp-servers.spec.md`)
  - `process-` — workflow / release / governance (e.g. `process-releases-strategy.spec.md`)
  - `ci-` — CI/CD pipeline work (e.g. `ci-hardening.spec.md`, `ci-dependabot-triage.md`)
  - `security-` — security architecture / hardening (e.g. `security-api-hardening.md`)

  Add a new prefix only if no existing category fits — document it in this list. Specs (`.spec.md`) describe forward-looking decisions and live in the `draft → proposed → approved` lifecycle; operational notes / triage / post-hoc docs use plain `.md` without the lifecycle (no frontmatter required). Each spec opens with YAML frontmatter:

  ```yaml
  ---
  status: draft # draft → proposed (issue filed) → approved (milestone attached)
  issue: TBD # filled in once the tracking issue is created
  ---
  ```

  Lifecycle: spec starts `draft`; flips to `proposed` when you file the tracking issue via `pnpm rando issues create` and link it as `issue: NNN` in frontmatter; flips to `approved` when a milestone is attached to the issue; **moves to `.notes/archive/` when the tracking issue closes** (or the spec is otherwise fully realized). Archived specs keep their filename and frontmatter — `status:` flips to `archived` and `closed:` records the date. The archive directory keeps the active spec list scannable; archived decisions stay reachable for historical context. `.notes/` is committed — these are shared decision records, public-facing for contributors. The file body holds background, options considered, tradeoffs, decision. Skip the entire flow only for trivial decisions (variable rename, doc typo) — anything that involved comparing options gets a spec file.

- **File a ticket via `pnpm rando issues create` for non-trivial work and reference it in commits/PRs** (`Closes #N` / `Refs #N`). Skip for typo fixes and one-line copy changes.
- **Prefer automation.** If something must stay manual, document it in `.github/MAINTAINING.md` / `.github/CONTRIBUTING.md` AND consider building a `rando` subcommand for it next time. The CLI is where setup steps go to die.
- **API changes → `pnpm rando api postman sync` after editing the OpenAPI spec.** The Postman collection mirrors the spec.

## Quality

- **Run lint + typecheck + tests-with-coverage before declaring work done OR drafting a commit message.** This is non-negotiable — CI runs the same checks and finding out from a failed CI run after pushing wastes a round trip. The canonical form is:
  ```
  pnpm typecheck && pnpm lint && pnpm test:coverage
  ```
  **Use `test:coverage`, not `test`.** CI runs `pnpm test:coverage` (via `unit-tests.yml`); the coverage variant enforces per-package thresholds in each vitest config and is the only way to catch threshold regressions locally. Plain `pnpm test` skips them. All three commands go through Turbo at the workspace root, which only re-runs affected packages (cache hits for everything else). Lint + typecheck + tests are NOT all wired as per-package scripts — only some packages have a `lint` script — so `pnpm --filter <pkg> lint` may error with "no script". Root-level is the safe default. For test files with `vi.fn(async () => ...)`, explicitly type the mock signature (`vi.fn(async (_a: X, _b?: Y) => ...)`) — implicit 0-arg inference breaks `.mock.calls[i][n]` access and tsc only catches it at typecheck time, not at `vitest run`. **Failing local checks (including coverage thresholds) = not done. Do not announce success, do not draft a commit message, until everything is green.**
- **PR checks + reviews must be green before merge.** Local checks cover what's runnable on a laptop; CI checks cover what isn't — real preview deploys, integration tests against staging / preview Postgres, Vercel builds, code-quality bots. Before suggesting a PR is ready to merge (or running `gh pr merge`), verify both:
  - Every check in the PR rollup is `SUCCESS` (or `SKIPPED` by design). Run `gh pr view <N> --json statusCheckRollup,reviewDecision` to inspect.
  - Every review thread (human OR bot) is `Resolved`. Reply on threads even when the original concern is fixed — silence reads as "ignored." For bot threads, the bot usually auto-resolves on the next pass after a fixing commit; for human threads, the human resolves.

  A red check that's masking real failure (recent example: a Postman check that was previously soft-skipping silently and now actually runs) is the kind of thing CI exists to catch — don't merge through it. Exceptions: known-flaky checks already documented as such, OR external infrastructure issues with a tracking issue filed AND a one-line justification in the merge commit body so future-us can audit. "Looks unrelated" by itself isn't enough.

- **File follow-ups instead of widening scope.** Half-finished implementations are worse than a fresh ticket.
- **Edit existing files over creating new ones.** New file = explicit reason. New doc file = explicit user request.
- **Commit messages follow `feat(scope):` / `fix(scope):` / `chore(scope):` / `test(scope):` / `docs(scope):` / `ci(scope):` style** with a one-line subject and optional body. Include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` for assisted work.
