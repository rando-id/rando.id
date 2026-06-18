# REST + OpenAPI via ts-rest — API style

## Decision

REST + OpenAPI surface, URL-versioned at `/v1/*`, served from
`apps/api`'s Next.js route handlers. Single ts-rest contract at
`packages/api-client/src/contract.ts` generates: the handler types,
the typed client (`@rando/api-client`), AND the `/v1/openapi.json`
output. One contract; CI fails if any of those drift.

## Why

- **One contract, three artifacts.** Editing a route means editing the contract — handler, client, OpenAPI spec all update together. Drift becomes impossible at the type level.
- **REST + OpenAPI for external surface.** External integrations + the Postman test loop + spec linting (`pnpm spec:lint`) all want OpenAPI. Generators exist for any client we'd ever need.
- **ts-rest for internal type safety.** End-to-end inference from contract → handler → client. No `if (response.kind === 'success')` boilerplate.
- **Co-located handlers.** Each route lives in `apps/api/app/v1/<path>/route.ts`. Easy to find, easy to test.

## Options considered

- **tRPC** — type-safe by construction, no schema-to-codegen step. Lost on: no automatic OpenAPI for external consumers (there's a translator but it's a maintenance burden), couples client + server tightly (deployment + cache invalidation concerns), and the native app (Expo) can't speak tRPC quite as cleanly.
- **GraphQL** — overkill for our shape (small set of resources, REST-natural CRUD). Schema-first GraphQL would add an entire build chain.
- **Hand-rolled REST + zod validation** — defensible, but we'd reinvent the contract surface ts-rest gives us. Cost: dozens of small inconsistencies between handler and client.
- **Hono / Fastify on a separate node server** — splits deployment + adds a service. Not warranted while Next.js route handlers can do the job.

## What we accept

- **The "raw Next handler" exception.** `/v1/webhooks/clerk` doesn't go through ts-rest because Svix signature verification needs raw-body access. Documented in README. Worth the one-off.
- **OpenAPI generation is technically a placeholder today** (commented in README "What's wired but not connected"). The contract is real; the `/v1/openapi.json` route is a stub that needs more polish.
- **ts-rest's TypeScript inference is sometimes slow on the IDE side.** Manageable.

## What would make us reconsider

- We need realtime push (websockets, server-sent events) — REST doesn't fit. Augment with a separate service rather than replace.
- The native app outgrows REST's request-response shape entirely.
- A specific framework (Fastify, Hono) becomes substantially better than what we're getting from Next.js for `apps/api`.
