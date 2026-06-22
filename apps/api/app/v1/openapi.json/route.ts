// /v1/openapi.json — Next handler that serves the generated OpenAPI spec.
//
// All the build logic lives in `./spec.ts` (pure, no Next runtime
// dependencies) so node scripts like `scripts/render-spec.ts` can
// invoke it without booting a server. This file is just the HTTP
// wrapper.

import { NextResponse } from 'next/server'
import { buildSpec } from './spec'

// Edge runtime: buildSpec is pure (no I/O), so cold-start is the
// dominant cost and edge is faster on that.
export const runtime = 'edge'

export function GET(): NextResponse {
  return NextResponse.json(buildSpec())
}
