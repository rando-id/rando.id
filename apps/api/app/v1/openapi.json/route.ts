import { NextResponse } from 'next/server'

// Placeholder. Will be generated from route schemas once we wire zod-openapi
// or @ts-rest. The Postman collection is built from this file.
const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Rando API',
    version: '0.0.0',
  },
  paths: {
    '/v1/health': {
      get: {
        summary: 'Health check',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
}

export function GET() {
  return NextResponse.json(spec)
}
