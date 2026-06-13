// Shared test helpers — capture stdout/stderr, stub fetch, fake interactive Io.

import { vi, type Mock } from 'vitest'
import type { Io, IoSpinner, SelectChoice } from '../output'

export interface CapturedSpinner {
  /** Final text on this spinner (start text overwritten by setText/resolvers). */
  text: string
  /** Sequence of state transitions on this spinner. */
  events: Array<{ type: 'succeed' | 'fail' | 'info' | 'warn' | 'stop'; text?: string }>
}

export interface CapturedIo {
  io: Io
  stdout: string[]
  stderr: string[]
  confirmCalls: string[]
  spinners: CapturedSpinner[]
  selectCalls: Array<{ message: string; choices: SelectChoice<unknown>[] }>
  inputCalls: Array<{ message: string; default?: string }>
}

export interface CaptureOptions {
  /** Return value for any `io.confirm(...)` call. Defaults to `true`. */
  confirm?: boolean
  /** FIFO queue of values to return from `io.select(...)` calls. */
  selectResponses?: unknown[]
  /** FIFO queue of values to return from `io.input(...)` calls. */
  inputResponses?: string[]
}

export function captureIo(options: CaptureOptions = {}): CapturedIo {
  const stdout: string[] = []
  const stderr: string[] = []
  const confirmCalls: string[] = []
  const spinners: CapturedSpinner[] = []
  const selectCalls: CapturedIo['selectCalls'] = []
  const inputCalls: CapturedIo['inputCalls'] = []
  let selectIdx = 0
  let inputIdx = 0

  const io: Io = {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    confirm: async (message) => {
      confirmCalls.push(message)
      return options.confirm ?? true
    },
    colors: {
      // Identity functions — tests assert on plain text without ANSI noise.
      success: (s) => s,
      error: (s) => s,
      warn: (s) => s,
      hint: (s) => s,
      bold: (s) => s,
      resource: (s) => s,
    },
    spinner: (text) => {
      const captured: CapturedSpinner = { text, events: [] }
      spinners.push(captured)
      const handle: IoSpinner = {
        succeed: (t) => {
          captured.events.push({ type: 'succeed', text: t })
          if (t) captured.text = t
        },
        fail: (t) => {
          captured.events.push({ type: 'fail', text: t })
          if (t) captured.text = t
        },
        info: (t) => {
          captured.events.push({ type: 'info', text: t })
          if (t) captured.text = t
        },
        warn: (t) => {
          captured.events.push({ type: 'warn', text: t })
          if (t) captured.text = t
        },
        stop: () => {
          captured.events.push({ type: 'stop' })
        },
        setText: (t) => {
          captured.text = t
        },
      }
      return handle
    },
    select: async <T>(message: string, choices: SelectChoice<T>[]) => {
      selectCalls.push({ message, choices: choices as SelectChoice<unknown>[] })
      const value = options.selectResponses?.[selectIdx++]
      if (value === undefined) {
        throw new Error(`captureIo: no selectResponses[${selectIdx - 1}] provided`)
      }
      return value as T
    },
    input: async (message, opts) => {
      inputCalls.push({ message, default: opts?.default })
      const value = options.inputResponses?.[inputIdx++]
      if (value === undefined) return opts?.default ?? ''
      return value
    },
  }

  return { io, stdout, stderr, confirmCalls, spinners, selectCalls, inputCalls }
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
