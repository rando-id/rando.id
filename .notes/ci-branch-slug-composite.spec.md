---
status: proposed # draft → proposed (issue filed) → approved (milestone attached)
issue: 206
---

# Branch slug as a shared composite action

Slug logic lives in three places today:

| Site                                                        | Form                                                           | State   |
| ----------------------------------------------------------- | -------------------------------------------------------------- | ------- |
| `packages/cli/src/commands/deploy.ts:482` (`slugifyBranch`) | TypeScript, canonical                                          | OK      |
| `.github/workflows/integration-tests.yml:284-286`           | Bash `tr` + `sed`, with comment pointing back to the TS source | OK      |
| `.github/workflows/deploy.yml:157`                          | Raw `${BRANCH}` — no slugification                             | **Bug** |

A branch like `Fix/Foo_Bar` writes `https://Fix/Foo_Bar-api.rando-id.dev`
into the PR-tracker comment (broken URL), while the real Vercel preview
is `https://fix-foo-bar-api.rando-id.dev`. Surfaced by Devin Review
on #187 ([thread](https://github.com/rando-id/rando.id/pull/187#discussion_r3463845579));
deferred so #187 stayed focused on per-app gating.

## Decision

Extract the bash slug into `.github/actions/branch-slug/` — a composite
action that takes a branch name and emits a `slug` output. Consumed by
both `deploy.yml` (the fix) and `integration-tests.yml` (collapsing the
existing inline copy into a single call site).

The TypeScript `slugifyBranch` in `packages/cli/src/commands/deploy.ts`
stays as the **CLI-side canonical**. We don't try to unify TS and bash
into one impl — the cost (forcing every workflow that wants a slug to
bootstrap pnpm/build before its first step) outweighs the drift risk.
Instead we add a unit test in `packages/cli` that asserts both
transformations produce identical output for a fixed corpus, so any
drift between the two impls surfaces as a failing test, not as a
silently-wrong URL in production.

## Why composite action (not Option B/C)

Three options surfaced from the issue body + investigation:

| Option                                                    | Pros                                                                                                                                                                   | Cons                                                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Composite action `.github/actions/branch-slug`**     | Matches the four existing composites (`changes`, `issue-refs`, `op-env`, `setup`). No bootstrap dependency — bash + checkout is enough. Single line at each call site. | Mild ceremony for ~3 lines of shell.                                                                                                               |
| **B. Sourceable script `.github/scripts/branch-slug.sh`** | Lighter than a composite — no `inputs:` / `outputs:` indirection.                                                                                                      | Introduces a new directory pattern (`scripts/`) not used elsewhere. Composite action gives us typed inputs + a named output.                       |
| **C. Expose via CLI: `rando deploy slug "$BRANCH"`**      | One canonical impl (TS), eliminates the integration-tests.yml comment-pointing-to-TS pattern entirely.                                                                 | `integration-tests.yml`'s slug step runs _before_ any pnpm install — adding bootstrap there is real workflow latency (≈30s) for one line of logic. |

**Option A wins** on convention fit + zero bootstrap cost. Option C is
the prettier long-term answer once we have a workflow-side reason to
bootstrap the CLI early anyway (e.g. broader migration off Vercel CLI
helpers); not justified by this PR alone.

## Composite action shape

```yaml
# .github/actions/branch-slug/action.yml
name: Branch slug
description: Convert a branch name to a DNS-safe slug, matching slugifyBranch in packages/cli/src/commands/deploy.ts.

inputs:
  branch:
    description: Branch name (typically `github.head_ref`).
    required: true

outputs:
  slug:
    description: DNS-safe slug — lowercase, `[^a-z0-9]+` collapsed to `-`, leading/trailing `-` stripped.
    value: ${{ steps.compute.outputs.slug }}

runs:
  using: composite
  steps:
    - id: compute
      shell: bash
      env:
        BRANCH: ${{ inputs.branch }}
      run: |
        SLUG=$(printf '%s' "$BRANCH" \
          | tr '[:upper:]' '[:lower:]' \
          | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
        echo "slug=${SLUG}" >> "$GITHUB_OUTPUT"
```

Branch input goes through `env:` (not template interpolation), matching
the CWE-77 hardening pattern from #198.

## Parity test (anti-drift)

`packages/cli/src/__tests__/deploy.test.ts` already has tests for
`slugifyBranch`. Add a fixture table of representative inputs
(uppercase, slashes, underscores, mixed, leading/trailing punctuation)
and assert each one against the expected output. The same fixture file
is read by a new `.github/actions/branch-slug/__tests__/parity.bats` (or
a plain shell script invoked from a workflow check) that runs the bash
pipeline against the same inputs and diffs the results.

If the two impls diverge, CI fails with a concrete diff. Implementation
note: keep the fixture in JSON (`packages/cli/src/__fixtures__/branch-slugs.json`)
so both languages can read it without a translation step.

## What we accept

- **Two impls, one corpus.** TS and bash both exist; drift caught by
  test, not by review. The cost of unifying (Option C) is higher than
  the cost of maintaining a fixture file.
- **No new CLI subcommand.** `rando deploy slug` would be the unified
  option, deferred per the table above. Revisit if integration-tests
  ever bootstraps pnpm before the slug step anyway.
- **No dependency on this for #204.** #204 (disable Vercel native PR
  previews) is independent — different file, different concern, no
  shared lines. Sequencing is "either order is fine."

## Adjacency to #204

If #204 lands Option A (disable Vercel native previews) our
`deploy.yml`-composed URL becomes the _only_ preview URL surfaced to PR
authors — there's no Vercel-native fallback comment for them to
compare against. That makes #206 a soft enabler for #204, not a
blocker: the slug bug is more visible without the fallback, but the bug
exists regardless.

## What would make us reconsider

- **A third bash-side caller** (e.g. a new workflow that needs to
  compute the slug) without a clear "we'd bootstrap the CLI here
  anyway" reason. At that point, the parity-test overhead exceeds
  the cost of just calling `rando deploy slug` from every site.
- **The TS `slugifyBranch` becomes non-trivial** (e.g. handles
  Unicode normalization, length limits matching Vercel's actual
  algorithm). Then keeping a bash mirror in sync is no longer cheap
  and we should consolidate on Option C.

## Touch points

1. `.github/actions/branch-slug/action.yml` — new composite (above).
2. `.github/workflows/deploy.yml:144-158` — add `uses: ./.github/actions/branch-slug` step before the issue-tracker sync; reference `${{ steps.slug.outputs.slug }}` (env-ified) in the `URL_LINES` line.
3. `.github/workflows/integration-tests.yml:277-287` — replace the inline `tr | sed` with the composite call; keep the comment about the security reasoning but drop the "Same slug logic as ..." pointer (now self-evident from the action name).
4. `packages/cli/src/__fixtures__/branch-slugs.json` — fixture corpus.
5. `packages/cli/src/__tests__/deploy.test.ts` — assert TS `slugifyBranch` matches the corpus.
6. `.github/actions/branch-slug/__tests__/parity.sh` (or equivalent) — invoked by a new step in `unit-tests.yml` (or piggybacked on `lint.yml`); fails if bash output diverges from the fixture.

Related: [[ci-per-app-preview-gating]] (the PR that surfaced this).
