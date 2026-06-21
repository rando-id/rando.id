# GitHub PAT — required scopes

**Status:** triage / TODO. Tracked in **#170**. The current fine-grained PAT (`GITHUB_TOKEN` in 1P) is missing scopes for at least two real operations we hit during normal work. Below is the full list of what the PAT needs based on a sweep of the repo.

## What's broken today

| Operation                         | Where                                                         | Symptom                                                                                                   |
| --------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `gh issue edit <N> --milestone …` | local, when attaching a milestone after `rando issues create` | `GraphQL: Resource not accessible by personal access token (updateIssue)` — see issue #169 attach session |
| `gh pr create`                    | local, after pushing a feature branch                         | falls back to manual GUI PR creation (this session, after the postman-push-spec branch landed)            |
| `git push -u origin <branch>`     | local, on a fresh feature branch                              | sometimes refused; user has been switching to SSH or `gh repo set-default` workarounds                    |

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

- Doctor check: `packages/cli/src/doctor/checks/env.ts:28` lists `GITHUB_TOKEN` as required when `tracker.kind=github`. The hint text at `packages/cli/src/commands/init.ts:114` says "Read+Write Issues on the repo" — outdated; update to reference this file once the scopes are widened.
- Adapter: `packages/cli/src/adapters/github-issues.ts` enumerates every REST endpoint we hit.
- 1Password: `GITHUB_TOKEN` lives in the 1P `local` Environment, pulled via `rando secrets sync`. Update in 1P first, then `direnv reload` to refresh the shell.

## Next steps

1. Generate a new fine-grained PAT at https://github.com/settings/personal-access-tokens with all five permissions above (Contents, Issues, Pull requests, Secrets, Workflows — plus Metadata: read which is automatic). Repository access: `rando-id/rando.id` only.
2. Update the 1Password item that backs `GITHUB_TOKEN` (local Environment) with the new value.
3. `direnv reload` in the repo, then `gh auth status` to confirm the new token is being picked up.
4. Smoke test: `gh issue edit <some-N> --add-label test`, `gh pr create --draft`, `git push --dry-run`. Remove the test label / close the draft after.
5. Update the hint text in `packages/cli/src/commands/init.ts:114` to match the wider scope.
6. Consider committing the updated `.env.example` if the token name or guidance changes.
