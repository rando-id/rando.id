---
status: proposed # draft → proposed (issue filed) → approved (milestone attached)
issue: 200
---

# Feature flags via adapter pattern

Rando uses GitHub Actions Variables today for what are
effectively feature flags — `PREVIEW_ENABLED`, `TRACKER_ENABLED`,
`POSTMAN_ENABLED`, `TRACKER_KIND` — read via `vars.X` in
workflow `if:` expressions. Managing them today means clicking
through `Settings → Secrets and variables → Actions → Variables`
in the GitHub UI, or running `gh variable set` with a PAT that
has the Variables permission.

Discovered while debugging PR #187's deploy-quota-blown state:
flipping `PREVIEW_ENABLED=false` to halt preview deploys
required either UI clicks or a freshly-permissioned PAT, both
slower than the incident response timeline wants.

## Decision

Build a `rando flags` CLI subcommand backed by a swappable
adapter, with the values declared in a git-tracked spec file
that `rando flags sync` reconciles to the remote.

Initial adapter: **GitHub Actions Variables** (matches what we
have today). Future adapters: **LaunchDarkly**, **PostHog
feature flags**, **Vercel Edge Config**, etc. — each lives
under `packages/cli/src/adapters/feature-flags/<vendor>.ts` and
registers in the `Adapters` factory like every other 3rd-party
adapter ([[project_rando_cli]] convention).

## Why "feature flags" not "CI variables"

CI variables is too narrow — it implies the storage backend
(GH Actions Variables) instead of the semantic role (a boolean
or enum knob that gates a feature). Calling them feature flags
keeps the interface stable across adapter swaps:

- `PREVIEW_ENABLED` reads the same whether the backend is GH
  Vars or a real flagging service.
- A future LaunchDarkly adapter wouldn't need to invent a
  rename to feel right.
- "Feature flag" also has industry-standard semantics (boolean,
  enum, percentage rollout, targeted user) that GH Vars can't
  express but a real flagging service can — the abstraction
  leaves room for that growth.

## Interface shape (rough)

```typescript
// domain/feature-flags.ts
export interface FeatureFlags {
  list(): Promise<Flag[]>
  get(name: string): Promise<Flag | null>
  set(name: string, value: string): Promise<void>
  unset(name: string): Promise<void>
}

export interface Flag {
  name: string
  value: string
  description?: string
}
```

Adapter implementations expose this; the CLI layer talks only
to the interface. Swap = change the registration line in
`Adapters`, no command-layer changes.

## Why a declarative spec (git-tracked) AND the adapter

Today's state lives in GitHub's UI. Two problems:

1. **No audit trail**. Variable changes don't show up in PR
   review. A misconfigured flag can ship without anyone seeing
   it until the workflow misbehaves.
2. **No bootstrap story**. Setting up a fresh fork requires a
   maintainer to manually click through Variables — no `rando
init` equivalent for it.

Spec lives in a git-tracked file (probably
`rando.config.json`'s new `featureFlags` block, OR a separate
`.rando/flags.json` if the config file is getting busy — TBD in
implementation):

```jsonc
{
  "featureFlags": {
    "kind": "github-actions-variables",
    "flags": {
      "PREVIEW_ENABLED": {
        "value": "false",
        "description": "Halt all preview deploys (quota saver / incident kill switch)",
      },
      "TRACKER_ENABLED": {
        "value": "true",
        "description": "Sync issue tracker on PR events",
      },
      "TRACKER_KIND": {
        "value": "github",
        "description": "Issue tracker backend (github | jira)",
      },
    },
  },
}
```

`rando flags sync` reads this file, compares against remote
state, and creates / updates / deletes to match — idempotent.
PR review then sees flag changes as ordinary diffs.

## CLI surface (initial)

| Command                      | Behavior                                                           |
| ---------------------------- | ------------------------------------------------------------------ |
| `rando flags list`           | Print all flags from the adapter                                   |
| `rando flags get NAME`       | Print one flag's value + metadata                                  |
| `rando flags set NAME VALUE` | Set one (and update the spec file too — keeps git in sync)         |
| `rando flags unset NAME`     | Delete one (and update spec)                                       |
| `rando flags sync`           | Reconcile spec → remote, idempotent                                |
| `rando flags status`         | Diff spec vs remote, print what would change                       |
| `rando flags doctor`         | Verify adapter auth + reachability ([[project_rando_cli]] pattern) |

## Auth

The Variables-scoped PAT (or LaunchDarkly API token, etc.) lives
in the staging 1Password Environment as `GH_VARIABLES_PAT` (or
similar — name TBD). `rando` loads it through the existing
secrets adapter — same pipe that delivers `VERCEL_TOKEN` and
`NEON_API_KEY`. No new credential-management primitive needed.

## Workflow consumption (the part that DOESN'T abstract away)

Workflows themselves still reference the backend natively:

- GH-Vars-backed: `if: vars.PREVIEW_ENABLED != 'false'` —
  template-evaluated at workflow start, zero runtime cost.
- LaunchDarkly-backed: would require a step that calls the LD
  API at workflow start and writes results to step outputs —
  more runtime cost, more failure modes (LD downtime → workflow
  blocked).

**This is the load-bearing tradeoff**: the management surface
abstracts cleanly, but the consumption surface in workflow YAML
is backend-specific. Swapping to LaunchDarkly later means a
sweep through the workflows to replace `vars.X` with a flag
evaluation step. The adapter pattern doesn't prevent that — it
just makes the management half painless.

For Rando's scale (small handful of binary flags), this is
acceptable. If we ever needed user-targeted flags or percentage
rollouts in production code (not workflow YAML), the LD swap
would happen for `apps/` code first, and workflows could stay
on GH Vars until they too need richer semantics.

## Options considered

- **Just use `gh variable set` directly.** Works for one-off
  flips. Loses: declarative source-of-truth, audit trail,
  bootstrap story for fresh forks. Skip — the value of the
  abstraction starts paying off at the second flag.
- **Single hardcoded GH-Vars implementation, no adapter.**
  Simpler today. But every other 3rd-party service in Rando
  uses the adapter pattern, and inconsistency would be
  surprising. The adapter cost is one extra file
  (`domain/feature-flags.ts`); negligible.
- **Skip the spec file, just provide `rando flags set/list`
  CLI.** Loses git-as-source-of-truth. Skip — half the value
  is review-via-PR.
- **Use 1Password Environments to store flag VALUES too.**
  Considered briefly. Skip — values are not secrets, and
  encrypted-at-rest storage for plaintext-in-workflow-logs
  values is noise. 1P holds the PAT only.
- **Use rando.config.json vs separate flags.json.** Defer to
  implementation. If the existing config grows past comfortable
  jsdoc, split; otherwise inline.

## What we accept

- **One more 1Password item** (`GH_VARIABLES_PAT`) and the
  matching schema in `setup-config.ts`'s `secrets` block.
- **Workflow YAML is still backend-specific.** GH Vars syntax
  in `if:` lines doesn't go through the adapter — that's the
  load-bearing tradeoff above.
- **Initial implementation is one adapter only.** Don't build
  LaunchDarkly speculatively; build the interface and the GH
  Vars impl, file follow-ups as real adapter needs arise.
- **`rando flags set` updates the spec file AND the remote.**
  Subtle: this means the operator can use `set` for one-off
  experiments knowing the change persists to git. Trade: an
  accidental `set` ends up in git, but that's strictly safer
  than the alternative (set sets remote-only, spec drifts).

## What would make us reconsider

- **A real feature flag service becomes worth it for
  application code** (not just workflow gates). Building
  `apps/web` user-targeting or percentage-rollout features
  is the moment to add a LaunchDarkly / PostHog adapter and
  start migrating consumers off `vars.X`.
- **GitHub adds typed variables / per-environment values.**
  Today GH Vars are flat strings, repo-scoped. If GitHub
  adds env-scoping or typed values, our spec format needs
  to grow to match.

## Touch points

1. `packages/cli/src/domain/feature-flags.ts` — interface
2. `packages/cli/src/adapters/feature-flags/github-actions-variables.ts`
   — initial impl (REST API + PAT auth via existing secrets
   adapter)
3. `packages/cli/src/config.ts` — register in `Adapters`
4. `packages/cli/src/commands/flags.ts` — CLI subcommands
5. `packages/cli/src/setup-config.ts` — add `featureFlags`
   block to the Zod schema
6. `rando.config.json` — populate with current flags
   (`PREVIEW_ENABLED`, `TRACKER_ENABLED`, `TRACKER_KIND`,
   `POSTMAN_ENABLED`) and their current values
7. `.github/CONTRIBUTING.md` / `.github/MAINTAINING.md` —
   short callout: "feature flags managed via `rando flags`;
   spec lives in `rando.config.json`"

## Out of scope (this issue)

- Migrating workflow YAML expressions to a non-GH-Vars backend.
  That's a separate decision triggered by needing application-
  code feature flags, not workflow gates.
- Per-environment flag values (LD-style). Defer until needed.
- Web UI / dashboard. CLI is sufficient.

Related: [[project_rando_cli]] (adapter pattern convention),
[[ci-vercel-protection-bypass]] (the incident that surfaced
the need — quota-burn during PR #187 left flag-flipping as
the load-bearing recovery step).
