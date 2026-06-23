---
status: proposed # draft → proposed (issue filed) → approved (milestone attached)
issue: 186
---

# Per-app preview deploys (only deploy what changed)

`deploy.yml`'s `branch-deploy` step currently fires
`rando deploy branch '${branch}' --stable-url` with no `--apps`
filter, so every PR triggers all three Vercel previews
(api + web + admin) regardless of which workspace actually
changed. With per-app `vercel.json` `ignoreCommand`s pinning
`turbo-ignore @rando/<app>` on the prod / staging side
([[ci-deploy-skip]]), this works correctly for push deploys
but the PR-preview path bypasses it entirely.

Combined with the Vercel free-tier 100/day quota that triggered
[[ci-preview-quota-strategy]], every unrelated PR burning 3
preview deploys instead of 1 is the obvious next gap.

## Decision

Gate each app's preview deploy on whether that app (or its
transitive workspace deps) actually changed. Pipe the affected
list into `rando deploy branch --apps <list>`. When no app is
affected, skip the deploy step entirely.

Same `.github/actions/changes` composite already surfaces
per-workspace booleans from Turbo's `--filter='...[base]'`
dry-run. Today it emits `api` and `web` outputs but **not
`admin`** — adding admin to the composite is part of this PR.

Concretely, `branch-deploy`'s deploy step becomes:

```yaml
- uses: ./.github/actions/changes
  id: changes

- name: Compute affected apps
  id: apps
  run: |
    APPS=""
    [ "${{ steps.changes.outputs.api }}"   = "true" ] && APPS="${APPS},api"
    [ "${{ steps.changes.outputs.web }}"   = "true" ] && APPS="${APPS},web"
    [ "${{ steps.changes.outputs.admin }}" = "true" ] && APPS="${APPS},admin"
    APPS="${APPS#,}"
    echo "list=${APPS}" >> "$GITHUB_OUTPUT"

- name: Trigger preview deploys
  if: steps.apps.outputs.list != ''
  run: rando deploy branch '${{ github.head_ref }}' --stable-url --apps ${{ steps.apps.outputs.list }}
```

`teardown` stays unconditional (the original
[[ci-deploy-skip]] rationale: closing a PR must always clean up
infra regardless of what state the diff ended up in).

## Why per-app gating in deploy.yml (not turbo-ignore again)

`turbo-ignore` is the right answer for **Vercel's native push
deploys** (controlled by per-app `vercel.json` — Vercel's build
process runs the ignoreCommand). For **PR previews** we go
through `rando deploy branch` in GitHub Actions, which calls
Vercel's REST API and bypasses `vercel.json`. The decision has to
live in deploy.yml.

The `.github/actions/changes` composite already does the
dep-graph traversal we need (via `turbo run test --filter`),
shared with `lint.yml` / `typecheck.yml` / `codeql.yml`. Reusing
its outputs is cheaper and more consistent than introducing a
parallel signal.

## How this composes with the Dependabot opt-in ([[ci-preview-quota-strategy]])

Two filters now apply in series to the PR preview path:

1. **Author gate** (from [[ci-preview-quota-strategy]]):
   Dependabot PRs skip unless they carry the `preview` label.
2. **Per-app affected gate** (this PR): even for
   human-authored or label-tagged PRs, only deploy the apps
   whose workspaces actually changed.

For a Dependabot PR that gets the `preview` label, this still
applies — if the bump only affects `@rando/db` (which only
`@rando/api` depends on), we deploy api but skip web + admin.

## Options considered

- **Skip only admin, keep web + api unconditional.** Matches the
  literal observation that admin gets the worst hit-to-actual-
  change ratio (smallest dep footprint). Smaller change but
  leaves quota on the table — a web-only PR would still fire an
  api preview unnecessarily. Skip — the implementation cost is
  the same as gating all three.
- **Modify `rando deploy branch` to read the diff itself and
  pick apps internally.** Hides the decision in CLI code where
  reviewers can't see it on the workflow page. Skip — keep the
  gating decision in YAML.
- **Use `turbo-ignore` directly in deploy.yml (call once per
  app).** Would work but requires 3 separate jobs / steps with
  the npx-fetch overhead each time. The composite action's
  Turbo run does the dep-graph traversal once for all
  workspaces and returns booleans — cheaper.
- **Don't gate per-app; just rely on Vercel's quota errors to
  surface waste.** Sloppy. Quota errors mid-PR break
  integration tests (`Integration tests` soft-skip on missing
  preview), and reviewers can't tell from the CI rollup that
  validation didn't actually run.

## What we accept

- **Admin (and any future thin app) skips most PRs by design.**
  Admin's deps are api-client + auth + brand + config +
  observability. A change to db, maps, or ui doesn't trigger
  admin. Reviewers wanting to verify admin against an unrelated
  change need to either touch an admin-affecting file or add an
  explicit gate-bypass (not implemented today; defer until
  someone actually needs it).
- **The `--apps` flag short-circuits when empty.** We gate the
  whole step on `list != ''` — if `--apps` were passed an empty
  string, `rando deploy branch`'s default is "all apps" which
  is the wrong behavior. The empty-list check makes that
  impossible.
- **One additional output in the composite.** `admin` was
  missing from `.github/actions/changes/action.yml`'s PKG map.
  Adding it is a one-line change but worth flagging — other
  workflows now have the `admin` signal available for any
  future per-app gating they need.
- **`code || shared` gate becomes redundant.** The
  per-workspace outputs already subsume both signals (Turbo
  treats `turbo.json` / root `package.json` changes as
  touching every workspace). Removing the now-redundant
  `code || shared` check from deploy.yml is part of this PR.

## What would make us reconsider

- **A new app workspace** lands without per-app gating wired
  in. The composite would need its PKG map updated. Document
  via the rule "every new app workspace needs an entry in
  `.github/actions/changes/action.yml`'s `PKG` map AND a
  corresponding gate in deploy.yml's `Compute affected apps`
  step".
- **Reviewers regularly want to preview an app that wasn't
  affected** by their changes (e.g. to verify a shared package
  bump didn't visually regress admin). Add a label
  (`preview:admin`?) or extend the existing `preview` label
  semantics. Not built today — defer until the friction is
  real.

## Touch points

1. `.github/actions/changes/action.yml` — add `admin` to the
   PKG map + outputs block. Two-line change.
2. `.github/workflows/deploy.yml` — replace the
   `code || shared` gate with the per-app compute-affected-apps
   step; pass `--apps <list>` to `rando deploy branch`; gate
   `op-env`, `issue-refs`, and the lifecycle sync on the same
   `list != ''` check; update the lifecycle-sync message to
   include only the URLs for apps that actually deployed.
3. `.github/MAINTAINING.md` → Deploy strategy → "Skipping
   deploys when no code changed": add subsection on per-app
   gating.

Related: [[ci-deploy-skip]], [[ci-preview-quota-strategy]],
[[ci-dependabot-triage]]
