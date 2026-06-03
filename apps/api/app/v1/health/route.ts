import { NextResponse } from 'next/server'

export const runtime = 'edge'

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'rando-api',
    version: '0.0.0',
    timestamp: new Date().toISOString(),
  })
}
