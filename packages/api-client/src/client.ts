// HTTP client + typed contract client.
//
// `createApiClient` returns an object with:
//   - `tsRest`: the typed ts-rest client (one method per contract route)
//   - `request`: a thin raw fetch wrapper kept for endpoints that don't
//     live in the contract (Svix-signed webhook + future escape hatches)
//   - `baseUrl`: kept for callers that need it
//
// The public wrappers in contacts.ts and lists.ts delegate to
// `tsRest.*` and use `unwrap` to convert {status, body} into either
// the body or an ApiError throw — preserving the legacy call-site
// behavior so apps/web + apps/native hooks don't have to change.

import { initClient, type InitClientReturn } from '@ts-rest/core'
import { contract } from './contract'

export type ApiClientOptions = {
  baseUrl: string
  getToken?: () => Promise<string | null>
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    body: string,
  ) {
    super(`API ${status} ${path}: ${body}`)
  }
}

type TsRestClient = InitClientReturn<typeof contract, { baseUrl: string }>

export type ApiClient = {
  baseUrl: string
  tsRest: TsRestClient
  request<T>(path: string, init?: RequestInit): Promise<T>
}

export function createApiClient({ baseUrl, getToken }: ApiClientOptions): ApiClient {
  const tsRest = initClient(contract, {
    baseUrl,
    baseHeaders: {},
    api: async ({ path, method, headers, body }) => {
      // Per-request auth + content-type injection so token rotation is
      // picked up without recreating the client (matches the legacy
      // request() behavior).
      const token = await getToken?.()
      const finalHeaders: Record<string, string> = {
        'content-type': 'application/json',
        ...(headers as Record<string, string>),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      }
      const res = await fetch(path, {
        method,
        headers: finalHeaders,
        body: body as BodyInit | null | undefined,
      })
      const text = await res.text()
      let parsed: unknown = undefined
      if (text) {
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = text
        }
      }
      return {
        status: res.status,
        body: parsed,
        headers: res.headers,
      }
    },
  })

  return {
    baseUrl,
    tsRest,
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      const token = await getToken?.()
      const res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new ApiError(res.status, path, body)
      }
      const text = await res.text()
      try {
        return JSON.parse(text) as T
      } catch {
        throw new ApiError(
          res.status,
          path,
          `Expected JSON response but got: ${text.slice(0, 200)}`,
        )
      }
    },
  }
}

/**
 * Convert a ts-rest response into either the body (on 2xx) or an
 * ApiError throw (on anything else). Used by every wrapper in
 * contacts.ts + lists.ts to preserve the legacy "return body / throw"
 * call-site shape that web + native hooks rely on.
 */
export function unwrap<T extends { status: number; body: unknown }>(
  response: T,
  path: string,
): unknown {
  if (response.status >= 200 && response.status < 300) {
    return response.body
  }
  throw new ApiError(response.status, path, JSON.stringify(response.body))
}
