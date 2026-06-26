---
status: draft
issue: TBD
---

# `rando.config.json` completeness — capture everything app-specific

## Why

CLAUDE.md says: "Anything app-related should be in `rando.config.json`." Today,
the config has 7 top-level fields (`project`, `repo`, `tunnel`, `domains`,
`apps`, `testing`, `db`, `secrets`, `tracker`) but a fork-and-rename of Rando
into a new app (`holonet`) would still need to grep-and-replace ~20+ hardcoded
strings across source, workflows, and configs.

This spec inventories the gap and lists what new keys (or computed
derivations) `rando.config.json` needs to grow so a `rando init <app>` flow
can fully describe an app without touching individual files.

## Audit — what's hardcoded today

Grouped by category, file:line + what gets hardcoded:

### CLI branding

| File:line                    | Hardcoded                                   | Today   |
| ---------------------------- | ------------------------------------------- | ------- |
| `packages/cli/src/cli.ts:42` | `'rando'` (Commander program name)          | Literal |
| `packages/cli/src/cli.ts:43` | `'Rando.id infrastructure CLI'` (help text) | Literal |
| `.husky/commit-msg`          | `rando issues lint-commit-msg`              | Literal |
| `.husky/prepare-commit-msg`  | `rando issues pick`                         | Literal |

### Env-var prefixes

| File:line                                         | Hardcoded                                                | Today   |
| ------------------------------------------------- | -------------------------------------------------------- | ------- |
| `packages/cli/src/commands/issues.ts:222,225,259` | `RANDO_NO_JIRA`                                          | Literal |
| `turbo.json:11,20`                                | `NEXT_PUBLIC_RANDO_API_URL`, `EXPO_PUBLIC_RANDO_API_URL` | Literal |
| `apps/web/src/lib/api-client.ts`                  | reads `NEXT_PUBLIC_RANDO_API_URL`                        | Literal |
| `apps/native/src/lib/client-api.ts`               | reads `EXPO_PUBLIC_RANDO_API_URL`                        | Literal |

### Dev-origin / domain allowlists

| File:line                                         | Hardcoded                               | Today   |
| ------------------------------------------------- | --------------------------------------- | ------- |
| `apps/web/next.config.ts:18`                      | `'dev-web.rando-id.dev'` allowed-origin | Literal |
| `apps/admin/next.config.ts:14`                    | `'dev-admin.rando-id.dev'`              | Literal |
| `apps/api/next.config.ts:15`                      | `'dev-api.rando-id.dev'`                | Literal |
| `apps/api/app/v1/openapi.json/spec.ts:216`        | `'https://api.rando.id'`                | Literal |
| `.github/workflows/integration-tests.yml:127`     | `'https://staging-api.rando-id.dev'`    | Literal |
| `.github/workflows/integration-tests.yml:141,153` | `'*.rando-id.dev'` glob                 | Literal |

All derivable from `config.domains.{nonProd,production}` + app names.

### Package scope / workspace names

| File:line                            | Hardcoded                                   | Today   |
| ------------------------------------ | ------------------------------------------- | ------- |
| `apps/{web,admin,api}/vercel.json:3` | `@rando/{web,admin,api}` turbo-ignore scope | Literal |

Derivable from package.json scope (which itself is the missing config item).

### User-Agent strings (rate-limit / etiquette)

| File:line                                   | Hardcoded          | Today   |
| ------------------------------------------- | ------------------ | ------- |
| `packages/maps/src/osm.ts`                  | `'rando.id/0.0.0'` | Literal |
| `apps/web/src/features/contacts/geocode.ts` | `'rando.id/0.1'`   | Literal |

OSM and other public APIs require a real product identifier. The
version is per-build; the product name is per-app.

### OpenAPI / Postman metadata

| File:line                                      | Hardcoded                                        | Today   |
| ---------------------------------------------- | ------------------------------------------------ | ------- |
| `packages/cli/src/setup-config.ts:156`         | `"Rando API"` (collection name default)          | Literal |
| `package.json:17`                              | `postman/rando-api.postman_collection.json` path | Literal |
| `apps/api/app/v1/openapi.json/spec.ts` (title) | OpenAPI doc title                                | Literal |

### 1P environment IDs in comments

| File:line                                    | Hardcoded              | Today                                                  |
| -------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| `.github/workflows/deploy-production.yml:92` | prod env id comment    | Literal (cross-ref `config.secrets.environments.prod`) |
| `.github/workflows/deploy-preview.yml:17,24` | staging env id comment | Literal                                                |

Already in config; the comments are duplicated for human readability
and should reference the config value instead.

## New / extended keys

```json
{
  "project": "rando",
  "cliName": "rando", // NEW — default = project
  "cliDescription": "Rando.id infrastructure CLI", // NEW
  "envPrefix": "RANDO", // NEW — default = upper(project)
  "packageScope": "@rando", // NEW — default = "@" + project
  "userAgent": "rando.id", // NEW — product UA for public APIs
  "domains": {
    "nonProd": "rando-id.dev",
    "production": "rando.id",
    "envSubdomains": {
      // NEW (optional)
      "dev": "dev",
      "staging": "staging"
    }
  },
  "api": {
    // NEW group (replaces flat testing.api)
    "openapi": {
      "title": "Rando API",
      "productionServer": "https://api.rando.id"
    },
    "testing": {
      "kind": "postman",
      "workspaceId": "92182519-…",
      "collectionName": "Rando API",
      "collectionPath": "postman/rando-api.postman_collection.json"
    }
  }
}
```

### What stays computed (not new keys)

Most of the hardcodings above can be **derived** rather than added as keys.
Preferred pattern: compute at config-load time.

- `<app>.<envSubdomain>.<nonProd domain>` → all dev/staging allowed-origins
- `<envSubdomain>-api.<nonProd domain>` → integration test staging URL
- `<packageScope>/<app.name>` → vercel.json turbo-ignore scope
- `<envPrefix>_NO_JIRA` → husky env var
- `NEXT_PUBLIC_<envPrefix>_API_URL` / `EXPO_PUBLIC_<envPrefix>_API_URL` → frontend env vars

Implementation lives in `packages/cli/src/config.ts` — extend the loader to
expose a derived `computed` object alongside the raw config.

### What `rando init` does with all of this

1. Walks files-with-known-templating (next.config.ts, vercel.json, husky
   hooks, turbo.json, OpenAPI spec.ts) and rewrites them from the resolved
   `computed` values.
2. Validates: greps for any remaining "rando" / "RANDO" / "rando.id" in
   files that should be app-neutral (workflows, configs, husky); fails
   loudly with file:line for any found.
3. Outputs a one-screen summary of "what your app is named, where it
   lives, what env vars look like."

## Touch points

1. `rando.config.json` — add the new keys above
2. `packages/cli/src/config.ts` — extend the loader; add `computed` object
   with derived values; defaults derive from `project` where possible
3. `packages/cli/src/setup-config.ts` — interactive prompts for the new
   fields (with derived defaults)
4. `packages/cli/src/commands/init.ts` (new) — `rando init <app>` flow
5. `apps/*/next.config.ts` — read allowed-origins from config import
6. `apps/api/app/v1/openapi.json/spec.ts` — read title + productionServer
   from config import
7. `apps/*/vercel.json` — write at template-generation time; not
   templated at runtime since Vercel reads it before our CLI runs
8. `.husky/{commit-msg,prepare-commit-msg}` — `${RANDO_CLI:-rando}` env
   var fallback so a forked repo can rename without touching .husky
9. `turbo.json` — passThroughEnv generalized to read from config

## What we accept

- **Backward compat for existing Rando.** All new keys are optional and
  default to existing literal values. Existing `rando.config.json` keeps
  working unchanged until a future major bump.
- **Some literals stay literal.** The CLI's command name in `.husky/`
  hooks is hard to fully template because the hook executes before
  config is loaded. Mitigation: env-var fallback (`${RANDO_CLI:-rando}`)
  documented in CONTRIBUTING.md.
- **Manual sweep for one-off hardcodings.** Comments and User-Agent
  strings will need a one-pass codemod the first time. Worth it for
  the long-term reusability win.

## What would make us reconsider

- **The audit finds far more hardcodings than listed.** Threshold:
  if `rando init <app>` would still leave > 5 manual edits, scope
  is wrong; either grow config further or accept that a fork is
  copy-paste forever.
- **A consumer of @theholocron/clients-\* hits the same problem with
  vendor-side identifiers.** That belongs in [[tech-clients-monorepo]],
  not here.

## Refs

- [[process-reusable-template]] — parent spec
- [[tech-clients-monorepo]] — vendor adapter side of the same story
- [[process-tracker-genericization]] — the JIRA-naming subset of this
- CLAUDE.md "anything app-related should be in `rando.config.json`"
