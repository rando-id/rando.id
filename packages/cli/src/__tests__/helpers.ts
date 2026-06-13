// Shared test helpers — capture stdout/stderr and stub fetch.

import { vi, type Mock } from 'vitest'
import type { Io } from '../output'

export interface CapturedIo {
  io: Io
  stdout: string[]
  stderr: string[]
  confirmCalls: string[]
}

export function captureIo(options: { confirm?: boolean } = {}): CapturedIo {
  const stdout: string[] = []
  const stderr: string[] = []
  const confirmCalls: string[] = []
  return {
    stdout,
    stderr,
    confirmCalls,
    io: {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      confirm: async (message) => {
        confirmCalls.push(message)
        return options.confirm ?? true
      },
    },
  }
}

export interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

export interface FetchStub {
  fetch: typeof fetch
  calls: FetchCall[]
  mock: Mock
}

/**
 * Build a stubbed `fetch` that returns the given responses in order. Each
 * response is `{ status, body }`; bodies are JSON-stringified if not strings.
 */
export function stubFetch(
  responses: Array<{ status?: number; body?: unknown; text?: string }>,
): FetchStub {
  const calls: FetchCall[] = []
  let i = 0
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = typeof init?.body === 'string' ? safeJsonParse(init.body) : (init?.body ?? null)
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: (init?.headers as Record<string, string>) ?? {},
      body,
    })
    const next = responses[i++] ?? { status: 200, body: {} }
    const status = next.status ?? 200
    const text =
      next.text ?? (typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {}))
    return new Response(text, { status })
  })
  return { fetch: mock as unknown as typeof fetch, calls, mock }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
