# `@rando/api-client`

Contract-first typed client for the Rando REST API. Built on
[`@ts-rest`](https://ts-rest.com) so the same contract drives:

- **Server handlers** in `apps/api/app/v1/**/route.ts` (via `@ts-rest/serverless/next`)
- **Typed fetch client** consumed by `apps/web` + `apps/native` hooks (via `@ts-rest/core`'s `initClient`)
- **OpenAPI 3.x spec** served at `/v1/openapi.json` (via `@ts-rest/open-api`)

Editing a route is one change: update the contract, and every downstream
surface fails its typecheck or snapshot until you reconcile. There is
no separate place where drift can hide.

## Layout

```
src/
  contract.ts   — single source of truth (route shapes, zod schemas, summaries)
  client.ts     — createApiClient() + the unwrap helper used by the wrappers
  contacts.ts   — wrappers around contract.{listContacts,createContact,getContact,updateContact}
  lists.ts      — wrappers around contract.{listLists,createList,getList,updateList,deleteList,addListMember,removeListMember}
  index.ts      — public exports
```

The wrappers exist for one reason: to preserve the legacy call-site
shape (`await listContacts(client, { lat, lng, q })`) so `apps/web`
and `apps/native` hooks don't change with every contract refactor.
They're thin — adapter glue, nothing more. Internally they all
delegate to `client.tsRest.<routeName>({...})` and use `unwrap()` to
convert ts-rest's `{ status, body }` response into either the body
(on 2xx) or an `ApiError` throw (on anything else).

## Adding a new endpoint

1. Define the route in `contract.ts` (method, path, summary, request
   schemas, response schemas — at least one 2xx, plus error shapes
   you care about).
2. Implement the handler in `apps/api/app/v1/**/route.ts` with
   `createNextHandler({ <routeName>: contract.<routeName> }, { … }, { handlerType: 'app-router' })`.
   TypeScript will reject any response that doesn't match the contract.
3. Add a wrapper in `contacts.ts` / `lists.ts` (or a new file) that
   calls `client.tsRest.<routeName>` and `unwrap`s the result.
4. Re-export from `index.ts`.
5. Run `pnpm --filter @rando/api test app/v1/openapi.json -u` to
   refresh the OpenAPI snapshot. Reviewers see the spec diff in the
   PR.

## The one exception: Clerk webhooks

`POST /v1/webhooks/clerk` stays a hand-rolled Next handler at
`apps/api/app/v1/webhooks/clerk/route.ts`. Svix signature verification
needs the raw request body before any JSON parsing, and ts-rest
parses the body up front to match the contract — they don't compose.
The handler stays narrow (one route, one purpose) so the divergence
is bounded.

## The OpenAPI snapshot drift gate

`apps/api/app/v1/openapi.json/__tests__/__snapshots__/route.test.ts.snap`
is committed. The test uses `toMatchSnapshot()`, so any contract
change that affects the wire shape fails CI until intentionally
updated with `pnpm vitest -u`. Reviewers see the spec diff line by
line in the PR — they can't miss a breaking change.

When the snapshot diff comes up in review:

- **Behavior-preserving** (e.g. a description or example added) → approve + update.
- **Breaking** (e.g. removed field, renamed path) → either bump the
  API to `/v2` or revert. Don't paper over with `-u`.
