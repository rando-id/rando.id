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
    },
    {
      setOperationId: true,
      operationMapper: (operation, appRoute) => {
        const tag = tagForPath(appRoute.path)
        return tag ? { ...operation, tags: [tag] } : operation
      },
    },
  )
  return NextResponse.json(spec)
}
