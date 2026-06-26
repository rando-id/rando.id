---
status: draft
issue: TBD
---

# Reusable template — what carries over to a new app (e.g. holonet)

## Why

Rando is being built as a startup-track project but also as a
reusable template for future apps the user owns. The user explicitly
wants to know: **if I started building holonet (or another app)
tomorrow, what carries over and what's app-specific?**

This audit identifies what's reusable infrastructure vs Rando
domain code, and structures the move so the next app inherits the
infra without copying the contacts-app code.

## The four reusability tiers

| Tier                                         | Definition                                                                                  | Examples                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **T1 — Publish externally**                  | Generic enough to live under `@theholocron/*` (or similar org), versioned, consumed via npm | `@rando/clients/*` (vendor adapters), shared types stack, eslint-config, tsconfig                                             |
| **T2 — Copy / fork structure, swap content** | Architecture works for every app but the data inside it is app-specific                     | Apps layout (`apps/api`, `apps/web`, `apps/admin`, `apps/native`), Drizzle schema scaffolding, OpenAPI scaffold, CI workflows |
| **T3 — App-specific**                        | Lives only in Rando                                                                         | Contacts feature code, locations / geo logic, Rando branding                                                                  |
| **T4 — Manual provisioning**                 | One-time setup per app; the CLI handles it                                                  | Vercel team, GH repo + ruleset, 1P account, Cloudflare zone                                                                   |

## Audit (current state)

### T1 candidates (publish to @theholocron)

| Surface                | Today                             | Move to                                                                                            |
| ---------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| 11 vendor adapters     | `packages/cli/src/adapters/`      | `@theholocron/clients-*` (per `[[tech-clients-monorepo]]`)                                         |
| `@rando/eslint-config` | `tooling/eslint-config`           | `@theholocron/eslint-config`                                                                       |
| `@rando/tsconfig`      | `tooling/tsconfig`                | `@theholocron/tsconfig`                                                                            |
| `@rando/observability` | `packages/observability`          | `@theholocron/observability` (if generic enough — likely needs review)                             |
| Shared design tokens   | `packages/brand` colors / spacing | Stay in app — brand is app-specific. Tokens shape (the schema) could publish; values stay per-app. |
| Rando CLI itself       | `packages/cli`                    | Probably stays per-app for now; could publish a generic core later                                 |

### T2 — Structure but not content

| Surface                                                                                                                                          | Reusable shape                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Monorepo layout (`apps/*` + `packages/*` + `tooling/*` + `tools/storybook` + `tools/playwright`)                                                 | Yes — copy structure                                           |
| `pnpm-workspace.yaml` catalog (default + 6 named)                                                                                                | Yes — copy with versions matching new app's chosen majors      |
| `rando.config.json`                                                                                                                              | Yes — fields are generic, values per-app                       |
| `.github/workflows/{deploy-preview,deploy-staging,deploy-production,sync-staging,unit-tests,lint,typecheck,codeql,integration-tests,issues}.yml` | Yes — all 10 are app-agnostic                                  |
| `.notes/*.spec.md` style + structure                                                                                                             | Yes — copy the convention; specs themselves are Rando-specific |
| `.github/ISSUE_TEMPLATE/*.yml` + `PULL_REQUEST_TEMPLATE.md`                                                                                      | Yes — copy + s/rando/<app>/                                    |
| `apps/api` shape (REST + OpenAPI + Postman testing)                                                                                              | Yes — copy + replace contract                                  |
| `apps/web` Next.js / Tamagui structure                                                                                                           | Yes — copy + replace features                                  |
| `apps/admin` Next.js structure                                                                                                                   | Yes                                                            |
| `apps/native` Expo structure                                                                                                                     | Yes                                                            |
| Drizzle schema scaffolding (db package + per-table file pattern)                                                                                 | Yes — copy + per-app schemas                                   |

### T3 — App-specific (Rando keeps)

- `packages/maps` — geo / OSM integration (might be partly T2 if
  another app needs maps)
- Contacts feature code in `apps/web` / `apps/admin`
- Rando branding assets in `packages/brand/assets/`
- Domain-specific test fixtures

### T4 — Per-app provisioning (CLI handles)

The `rando` CLI (or its `@theholocron/cli` successor) already
abstracts most of these:

- Vercel project create + env-var push (`rando infra setup`)
- Cloudflare DNS + tunnel
- Neon project + branches
- 1P environment provisioning (if Option D in
  `[[security-secrets-strategy]]` survives)
- GH repo settings + ruleset (#222)

Anything still manual goes into a `rando init <app>` flow that
walks the operator through the gaps.

## Decision — proposed structure for "new-app onboarding"

A new app starts from a template repo (e.g. `theholocron/app-template`)
that contains:

- Monorepo layout (T2 copies)
- Workflows + ruleset config (T2 copies)
- Catalog stub (T2 — versions match holonet's chosen majors at fork
  time)
- `rando.config.json` template with placeholders
- Empty `.notes/` directory
- `apps/{api,web,admin,native}` scaffolds (T2 copies)
- `packages/{db,api-client,observability,...}` scaffolds (T2 copies)
- `@theholocron/clients-*` npm deps (T1, no copy)

Then:

```
gh repo create theholocron/holonet --template theholocron/app-template
cd holonet
pnpm rando init  # walks the operator through Vercel team, GH ruleset,
                 # Neon project, Cloudflare zone, 1P (or GH env), etc.
pnpm rando infra setup --dry-run
pnpm rando infra setup
```

End state: fresh repo, deployable, with no copy-paste from Rando's
domain code.

## What blocks this today

1. **[[tech-clients-monorepo]] not landed** — adapters still live in
   `packages/cli/src/adapters/` not in `@theholocron/clients-*`
2. **[[process-tracker-genericization]] not landed** — Jira-flavored
   naming would copy over confusingly
3. **[[process-env-management]] not landed** — `.env.example` doesn't
   yet have tool grouping for clean fork-and-swap
4. **No `rando init` command** — the per-app provisioning flow is
   half-built (`rando infra setup` covers most but not Vercel team
   creation, GH repo creation)
5. **`@theholocron/eslint-config` + `@theholocron/tsconfig` don't
   exist** — these are easy wins post-T1

## Suggested sequencing

1. Land [[tech-clients-monorepo]] Phase 1 (in-repo `packages/clients`)
2. Land [[process-tracker-genericization]]
3. Land [[process-env-management]]
4. Land [[process-deploy-strategy]] follow-ups (auto-merge etc, already there)
5. Extract `@theholocron/{clients-*, eslint-config, tsconfig}` to
   the external monorepo
6. Build `rando init <app>` — the missing piece
7. Create `theholocron/app-template` GitHub template repo
8. Fork it to start holonet

Steps 1-4 happen in Rando. Step 5+ are the actual extraction work.

## What we accept

- **Two-codebase maintenance** once `@theholocron/*` exists. Mitigation:
  treat `@theholocron/*` as semver-strict; never break consumers
  without a major bump.
- **Rando-the-app gets a refactor** during step 1-2 because moves are
  destructive. Mitigation: phased, each PR self-contained, CI
  catches regressions.

## What would make us reconsider

- **Holonet specs come back radically different** from Rando (e.g.
  needs a different framework, different region, different
  vendor stack). At that point the template is too narrow; either
  parameterize harder or ship two templates.

## Refs

- [[tech-clients-monorepo]] — T1 publishing
- [[process-tracker-genericization]] — T2 cleanup
- [[process-env-management]] — T2 cleanup
- [[security-secrets-strategy]] — T4 path choice
- #222 — `rando setup gh` (T4 automation)
- CLAUDE.md — current architecture conventions
