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
    },
    { setOperationId: true },
  )
  return NextResponse.json(spec)
}
