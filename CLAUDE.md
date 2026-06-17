# CLAUDE.md

Conventions for working on Rando. Loaded automatically by Claude Code into every conversation.

## Code patterns

- **Adapter pattern for any 3rd-party service.** `domain/X.ts` (interface) + `adapters/X.ts` (impl) + register in the `Adapters` factory in `packages/cli/src/config.ts`. Applies to vendor APIs/CLIs (Vercel, Neon, Clerk, 1P, GitHub, Postman). Skip for pure utility libs (zod, lodash) where the swap risk is essentially zero.
- **Soft-skip over hard-fail when a dependency is missing or optional.** The orchestrator never blocks on auth issues, missing `.env.example`, or missing 1P keys — it emits a note and continues so the rest of the pipeline still runs.
- **Idempotent orchestrator steps.** Check-then-create, treat "already exists" / 409 as success, never blow up on re-runs.
- **`.env.example` is the per-context contract.** The keys an app declares in its `.env.example` determine what gets synced from 1P locally AND what gets pushed to Vercel for that app's deploy. No hardcoded variable lists.
- **Future: centralize fetch in a single `packages/clients` package.** Not built yet — direction only. Today's `packages/cli/src/adapters/*` and `packages/api-client/*` should converge there. When writing new fetch code, ask whether it belongs in the central package first; if you build it elsewhere, leave a comment noting the eventual move.

## Workflow

- **Commit messages → pasteboard.** When the user asks for one, draft it and pipe to `pbcopy`, then announce in one sentence. Don't paste the message into the conversation.
- **File a ticket via `pnpm rando issues create` for non-trivial work and reference it in commits/PRs** (`Closes #N` / `Refs #N`). Skip for typo fixes and one-line copy changes.
- **Prefer automation.** If something must stay manual, document it in `.github/MAINTAINING.md` / `.github/CONTRIBUTING.md` AND consider building a `rando` subcommand for it next time. The CLI is where setup steps go to die.
- **API changes → `pnpm rando api postman sync` after editing the OpenAPI spec.** The Postman collection mirrors the spec.

## Quality

- **Run lint + typecheck + tests before declaring work done OR drafting a commit message.** This is non-negotiable — CI runs the same checks and finding out from a failed CI run after pushing wastes a round trip. The canonical form is:
  ```
  pnpm typecheck && pnpm lint && pnpm test
  ```
  These each go through Turbo at the workspace root, which only re-runs affected packages (cache hits for everything else). Lint + typecheck + tests are NOT all wired as per-package scripts — only some packages have a `lint` script — so `pnpm --filter <pkg> lint` may error with "no script". Root-level is the safe default. For test files with `vi.fn(async () => ...)`, explicitly type the mock signature (`vi.fn(async (_a: X, _b?: Y) => ...)`) — implicit 0-arg inference breaks `.mock.calls[i][n]` access and tsc only catches it at typecheck time, not at `vitest run`. **Failing local checks = not done. Do not announce success, do not draft a commit message, until everything is green.**
- **File follow-ups instead of widening scope.** Half-finished implementations are worse than a fresh ticket.
- **Edit existing files over creating new ones.** New file = explicit reason. New doc file = explicit user request.
- **Commit messages follow `feat(scope):` / `fix(scope):` / `chore(scope):` / `test(scope):` / `docs(scope):` / `ci(scope):` style** with a one-line subject and optional body. Include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` for assisted work.
