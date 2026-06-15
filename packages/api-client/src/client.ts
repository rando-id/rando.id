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

export function createApiClient({ baseUrl, getToken }: ApiClientOptions) {
  return {
    baseUrl,
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

export type ApiClient = ReturnType<typeof createApiClient>
