// Generated OpenAPI spec — single source of truth for any downstream
// tooling (Postman, Swagger UI, client codegen, etc.).
//
// @ts-rest/open-api walks the contract and emits a 3.x spec with each
// route's method/path/query/body/responses pulled straight from the
// zod schemas. No hand-rolled metadata required; drift between the
// contract and this output is impossible.

import { NextResponse } from 'next/server'
import { generateOpenApi } from '@ts-rest/open-api'
import { contract } from '@rando/api-client'

// Edge runtime: the generator is pure (no I/O), so cold-start is the
// dominant cost and edge is faster on that.
export const runtime = 'edge'

// Top-level tag definitions — these populate `tags[]` in the OpenAPI
// doc so spec viewers (Postman Spec Hub, Swagger UI, Redocly) can show
// grouped sections with descriptions. The per-operation `tags[]` array
// is filled by the operationMapper below based on the route path.
const TAGS = [
  { name: 'Health', description: 'Liveness + identity checks (unauthenticated).' },
  { name: 'Contacts', description: 'Create, read, and update a user’s contacts.' },
  { name: 'Lists', description: 'Custom lists of contacts and their members.' },
] as const

// Reusable components — schemas + security schemes + named error
// responses. These show up in Postman Spec Hub's Components panel
// (and any other OpenAPI viewer) so consumers see the auth model +
// recurring shapes in one place. Routes don't $ref these directly
// yet — that's a follow-up refactor; declaring them at the component
// level still surfaces the contract clearly.
const ERROR_RESPONSE_REF = {
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
  },
} as const

const COMPONENTS = {
  schemas: {
    ErrorBody: {
      type: 'object',
      required: ['error'],
      properties: {
        error: {
          type: 'string',
          description: 'Short, human-readable error message — safe to log + display.',
        },
        issues: {
          type: 'array',
          description: 'Per-field zod validation issues when applicable (400 only).',
          items: {},
        },
      },
    },
  },
  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'Clerk-issued session JWT. Frontend obtains it via `clerk.session.getToken()` and forwards as `Authorization: Bearer <token>`. Validated server-side by `requireCurrentUser`.',
    },
  },
  responses: {
    Unauthorized: {
      description: 'Missing or invalid Clerk session JWT.',
      ...ERROR_RESPONSE_REF,
    },
    NotFound: {
      description:
        'Requested resource does not exist OR is owned by a different user (handlers conflate the two on purpose so cross-tenant existence isn’t leaked).',
      ...ERROR_RESPONSE_REF,
    },
    BadRequest: {
      description:
        'Request body or query parameters failed zod validation. `issues[]` carries the per-field detail.',
      ...ERROR_RESPONSE_REF,
    },
    ServerError: {
      description:
        'Unexpected server error — typically a database constraint violation or downstream timeout. Safe to retry on a backoff.',
      ...ERROR_RESPONSE_REF,
    },
  },
} as const

/**
 * Resolve a single tag name from a route path. Routes that don’t match
 * any prefix end up without a tag — currently no such routes exist,
 * but a fall-through is intentional so future additions don’t silently
 * pick up the wrong group.
 */
function tagForPath(path: string): string | null {
  if (path.startsWith('/v1/health')) return 'Health'
  if (path.startsWith('/v1/contacts')) return 'Contacts'
  if (path.startsWith('/v1/lists')) return 'Lists'
  return null
}

/**
 * Decide per-operation security: every route is bearer-gated EXCEPT
 * /v1/health (the contract calls out "Public, unauthenticated" — keep
 * the spec honest). Returning an empty array overrides the top-level
 * default per OpenAPI 3.0 rules.
 */
function securityForPath(path: string): Array<Record<string, string[]>> | undefined {
  if (path.startsWith('/v1/health')) return []
  return undefined // inherit top-level default
}

export function GET(): NextResponse {
  const spec = generateOpenApi(
    contract,
    {
      info: {
        title: 'Rando API',
        version: '0.0.0',
        description:
          'Auto-generated from the ts-rest contract in @rando/api-client. Edit the contract, not this output.',
      },
      servers: [
        { url: 'https://api.rando.id', description: 'Production' },
        { url: 'http://localhost:4000', description: 'Local dev' },
      ],
      tags: [...TAGS],
      components: COMPONENTS,
      security: [{ bearerAuth: [] }],
    },
    {
      setOperationId: true,
      operationMapper: (operation, appRoute) => {
        const tag = tagForPath(appRoute.path)
        const security = securityForPath(appRoute.path)
        return {
          ...operation,
          ...(tag ? { tags: [tag] } : {}),
          ...(security !== undefined ? { security } : {}),
        }
      },
    },
  )
  return NextResponse.json(spec)
}
