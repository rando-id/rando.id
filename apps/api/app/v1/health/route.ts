// Pilot for the ts-rest contract-first migration. Once every endpoint
// is converted, /v1/openapi.json will generate from the same contract
// the client + handlers share — no drift possible at the type level.

import { createNextHandler } from '@ts-rest/serverless/next'
import { contract } from '@rando/api-client'

// Edge runtime: cold-start is meaningfully faster for a health probe.
export const runtime = 'edge'

const handler = createNextHandler(
  { health: contract.health },
  {
    health: async () => ({
      status: 200,
      body: {
        ok: true,
        service: 'rando-api',
        version: '0.0.0',
        timestamp: new Date().toISOString(),
      },
    }),
  },
  { handlerType: 'app-router' },
)

export { handler as GET }
