# GitHub PAT — required scopes

**Status:** applied 2026-06-22. Tracked in **#170**. The local fine-grained PAT (`GITHUB_TOKEN` in 1P) has been rotated to match the scope table below. `gh pr create` and `gh pr edit` both verified working post-rotation. The doc stays as the canonical scope reference for future rotations and for any new contributor provisioning their own PAT.

## What was broken before the rotation

| Operation                         | Where                                                         | Symptom                                                                                                           |
| --------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `gh issue edit <N> --milestone …` | local, when attaching a milestone after `rando issues create` | `GraphQL: Resource not accessible by personal access token (updateIssue)` — see issue #169 attach session         |
| `gh pr create`                    | local, after pushing a feature branch                         | fell back to manual GUI PR creation; resolved post-rotation — PR #177 was opened + edited via `gh` from a session |
| `git push -u origin <branch>`     | local, on a fresh feature branch                              | sometimes refused; user had been switching to SSH or `gh repo set-default` workarounds                            |

## Scopes the project actually uses

Fine-grained PAT permissions for repo `rando-id/rando.id`:

| Permission            | Read | Write | Used by                                                                                                                                                                                                                |
| --------------------- | ---- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Metadata**          | ✓    | —     | Required for any fine-grained PAT                                                                                                                                                                                      |
| **Contents**          | ✓    | ✓     | `git push` from CLI, anything that reads code via the API                                                                                                                                                              |
| **Issues**            | ✓    | ✓     | `rando issues create`, label/milestone/comment via `packages/cli/src/adapters/github-issues.ts` (POST `/issues`, PATCH `/issues/{n}`, POST `/issues/{n}/labels`, POST `/issues/{n}/comments`, DELETE `/labels/{name}`) |
| **Pull requests**     | ✓    | ✓     | `gh pr create`, future `rando pr` siblings                                                                                                                                                                             |
| **Secrets** (Actions) | —    | ✓     | `gh secret set` via `rando secrets push-github` — bootstraps `OP_SERVICE_ACCOUNT_TOKEN` into Actions before any 1Password call works in CI                                                                             |
| **Workflows**         | ✓    | —     | reading workflow status (`gh run list`); write only needed if we ever rewrite workflow YAML via API                                                                                                                    |
| **Actions**           | ✓    | —     | `gh run watch` etc.                                                                                                                                                                                                    |

Two extras worth re-checking when the PAT is updated:

1. **Issues GraphQL mutations** — fine-grained PATs historically had gaps on GraphQL `updateIssue` even with Issues: write set. If it still 403s after the rewrite, the workaround is the milestone-pick step in the GitHub UI (already happening) or switching that one call to the REST `PATCH /issues/{n}` endpoint we already use in `github-issues.ts`.
2. **Milestone CRUD** — we only attach existing milestones today; create-milestone would need Issues: write (same scope). No code path needs that yet.

## Things the PAT does NOT need

Keep these OFF to limit blast radius:

- Administration (admin-level repo settings)
- Code scanning alerts, dependabot, deployments — handled by GitHub Actions' own `GITHUB_TOKEN`, not the user PAT
- Anything at org level — repo-scoped only

## Cross-references

- Doctor check: `packages/cli/src/doctor/checks/env.ts:28` lists `GITHUB_TOKEN` as required when `tracker.kind=github`. The hint text in `packages/cli/src/commands/init.ts` was widened in this PR to reference this doc — keep the two in sync if either changes.
- Adapter: `packages/cli/src/adapters/github-issues.ts` enumerates every REST endpoint we hit.
- 1Password: `GITHUB_TOKEN` lives in the 1P `local` Environment, pulled via `rando secrets sync`. Update in 1P first, then `direnv reload` to refresh the shell.

## Rotation runbook (next time)

The same procedure applies whenever the PAT is rotated (expiry, suspected leak, contributor onboarding):

1. Generate a fine-grained PAT at https://github.com/settings/personal-access-tokens with the permissions in the scope table above (Contents, Issues, Pull requests R+W; Secrets W; Workflows + Actions R; Metadata R is automatic). Repository access: `rando-id/rando.id` only.
2. Update the 1Password item that backs `GITHUB_TOKEN` (local Environment) with the new value.
3. `direnv reload` in the repo, then `gh auth status` to confirm the new token is being picked up.
4. Smoke test: `gh pr create --draft`, `gh issue edit <some-N> --add-label test`, `git push --dry-run`. Remove the test label / close the draft after.
5. If you widen or narrow the scope set, update the table above AND the hint text in `packages/cli/src/commands/init.ts` (`TOKEN_HELP.GITHUB_TOKEN`).
