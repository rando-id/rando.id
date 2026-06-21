---
status: approved # draft → proposed (issue filed) → approved (milestone attached)
issue: 169
---

# Postman OpenAPI spec sync — push the spec, not just the collection

## Decision

Extend the existing Postman adapter (`packages/cli/src/adapters/postman.ts`)
to push the OpenAPI spec itself into Postman as an **API entity** —
not just the derived collection. Expose it as
`rando api postman push-spec`, wired into the same `pnpm rando api postman sync`
flow that already mirrors the collection. CI on spec changes pushes both
artifacts; Postman's API workspace becomes a faithful mirror of the contract
in `packages/api-client/src/contract.ts`.

## Why

- **The spec is the contract.** Today `rando api postman sync` only pushes the **collection** generated from the spec. Anyone browsing the Postman workspace sees endpoints + tests but not the spec-shaped view (schemas, security schemes, server URLs) the API entity provides. Consumers asking "what does this API look like?" go to Postman expecting the spec — and find a collection.
- **Stays in the adapter pattern.** [[project_rando_cli]] already has `PostmanProvider` (domain) + `PostmanRestProvider` (adapter) with `importOpenApi` (which generates a collection). Adding `createApi` / `createApiSchema` / `updateApiSchema` methods is the same shape, registered in the same `Adapters` factory. No new package, no new auth path.
- **Single source of truth.** [[tech-api-rest-openapi]] already declares `/v1/openapi.json` as the canonical artifact (generated from the ts-rest contract). Pushing that exact bytes to Postman closes the loop — Postman, GitHub, and the running API all show the same spec.
- **Unlocks downstream Postman features we may want later.** API governance rules, spec linting in the Postman UI, contract testing in their CLI, and (if we ever want them) mocks anchored to the spec rather than the collection. All require the API entity to exist.

## Options considered

- **Status quo: collection-only sync.** Cheapest path, what we have. Cost: the Postman workspace shows endpoints but no schema-level spec view, and the API entity stays empty/stale. Doesn't compound — every new Postman feature we'd ever want (mocks, contract tests, governance) starts from the API entity, not the collection.
- **Postman's GitHub integration.** Postman can watch a GitHub repo and sync OpenAPI files automatically — set up in the Postman UI, takes a deploy key. Works but moves config out of code, breaks the [[project_rando_cli]] "everything goes through `rando`" stance, and leaves no audit trail in our repo. Skip.
- **Manual import via Postman desktop.** Drag-drop `openapi.json` into Postman's "APIs" sidebar. Fine for first-time exploration; documented as a footnote. Not the long-term answer because nothing prevents it going stale.
- **Skip Postman APIs entirely, use a third-party doc host (Stoplight, Redocly).** Heavier — adds another vendor. We already pay for Postman. Defer until we outgrow Postman's spec view.

## What we accept

- **Two artifacts to keep in sync.** The collection and the API entity now both come from the same spec, but Postman treats them as separate objects. The adapter pushes both in `sync`; if one half fails (e.g. transient 5xx on the API endpoint) the orchestrator emits a note and continues — [[project_rando_cli]]'s soft-skip rule.
- **Postman API IDs aren't stable across delete-and-recreate.** Same trade-off the collection sync already makes (see `postman.ts` comment at top of file). Documented in the domain interface; consumers shouldn't link to the Postman UI by ID.
- **One more API key scope.** The existing `POSTMAN_API_KEY` already has API-Builder permissions on personal keys, so no new secret needed. Verify before shipping; if a narrower scope is required we add a `POSTMAN_API_BUILDER_KEY` to [[project_rando_stack_decisions]] and the 1Password Environments.
- **No mocks, no Flows.** Explicit out-of-scope for this work. Mocks revisit when a frontend collaborator joins; Flows is a permanent skip (vendor-locked visual scripting that duplicates `@rando/api-client`).

## What would make us reconsider

- Postman deprecates or fundamentally reworks the API Builder endpoints (they've churned this surface before). Fall back to status quo + GitHub integration.
- We move off Postman entirely for API testing (e.g. Hurl, Bruno, hand-rolled vitest against the dev server). Then both this sync and the existing collection sync go away together.
- A future collaborator wants the Postman GitHub integration's "auto-PR on spec drift" feature badly enough to outweigh the config-in-UI cost.

## Implementation sketch

1. **Domain** — add to `packages/cli/src/domain/postman.ts`:
   ```ts
   findApiByName(input: { workspaceId; name }): Promise<PostmanApi | null>
   createApi(input: { workspaceId; name; summary? }): Promise<PostmanApi>
   upsertApiSchema(input: { apiId; version; spec }): Promise<void>
   ```
2. **Adapter** — `PostmanRestProvider` implements them against:
   - `GET /apis?workspaceId=…`
   - `POST /apis` / `PUT /apis/{id}`
   - `POST /apis/{id}/versions/{version}/schemas` (multipart or JSON depending on content type)
3. **Command** — `rando api postman push-spec` reads `packages/api-client/src/openapi.json` (the generated artifact from [[tech-api-rest-openapi]]) and calls `upsertApiSchema`. Idempotent: create-API-if-missing, then upsert schema. Same shape as the orchestrator's other steps.
4. **`rando api postman sync` calls both.** Push-spec → push-collection. Order matters only insofar as the collection can be linked to the API entity in Postman; if linking is hard, ship them as parallel pushes and link in the UI once.
5. **CI** — `integration-tests.yml` (or a new `spec-sync.yml`) runs `rando api postman push-spec` on push to `main` when `packages/api-client/**` changes. Gate behind the `code` aggregate from the `changes` composite action.
6. **Docs** — extend `.github/CONTRIBUTING.md`'s "API testing — Postman CLI" section to mention the spec push alongside the collection sync.

## Resolved questions

- **Postman plan blocks API entities entirely on the Free tier.** First live run of `rando api postman push-spec` against the user's workspace returned `400 limitReachedError: "You can create up to 0 APIs on your current plan."` This is a _plan_ limit, not a _scope_ limit on the PAT — no PAT change will unblock it. Two paths forward:
  1. Upgrade to a Postman plan that includes APIs (Basic ~$15/user/mo as of mid-2026, includes 3 APIs). Not warranted while Rando is solo + pre-launch.
  2. Stay on Free, lean on the collection-only flow, and let `sync`'s soft-skip absorb the failure with a note. Standalone `rando api postman push-spec` will hard-fail until upgrade — that's correct behavior, no fix needed in code.
- **API entity name = `Rando API`** — matches the collection name (`DEFAULT_COLLECTION_NAME`), so when the plan limit is lifted the sidebar shows one logical "API" with collection nested under it.
- **Versioning = `v1` from day one** — cheap, future-proofs for `v2` later.
