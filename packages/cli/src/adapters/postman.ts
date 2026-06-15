// Postman REST API implementation of PostmanProvider.
//
// API reference: https://learning.postman.com/docs/developer/postman-api/
// Auth: `X-Api-Key: <api-key>` header (no Bearer prefix). The key is
// per-user, generated at https://web.postman.co/settings/me/api-keys.
//
// Endpoints we touch:
//   GET    /me                      → user identity (for doctor)
//   GET    /workspaces              → list workspaces (for init)
//   GET    /collections?workspace=… → list a workspace's collections
//   DELETE /collections/{uid}       → remove an old collection on re-sync
//   POST   /import/openapi          → create a fresh collection from a spec
//
// We chose delete-and-recreate over hunting for a stable update path
// because Postman's "API Builder" stable-id workflow is much more
// complex and changing under our feet. Trade-off is the collection ID
// changes per sync; documented in the domain interface.

import { ProviderApiError } from '../domain/errors'
import type {
  PostmanCollection,
  PostmanProvider,
  PostmanUser,
  PostmanWorkspace,
} from '../domain/postman'

const BASE_URL = 'https://api.getpostman.com'

export interface PostmanAdapterOptions {
  apiKey: string
  /** Override for tests. Defaults to global fetch. */
  fetch?: typeof fetch
  /** Override base URL for tests. */
  baseUrl?: string
}

export class PostmanRestProvider implements PostmanProvider {
  private readonly fetch: typeof fetch
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(opts: PostmanAdapterOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch
    this.baseUrl = (opts.baseUrl ?? BASE_URL).replace(/\/+$/, '')
    this.apiKey = opts.apiKey
  }

  async getMyself(): Promise<PostmanUser> {
    const raw = await this.request<{ user: RawUser }>('GET', '/me')
    return mapUser(raw.user)
  }

  async listWorkspaces(): Promise<PostmanWorkspace[]> {
    const raw = await this.request<{ workspaces: RawWorkspace[] }>('GET', '/workspaces')
    return raw.workspaces.map(mapWorkspace)
  }

  async findCollectionByName(input: {
    workspaceId: string
    name: string
  }): Promise<PostmanCollection | null> {
    const raw = await this.request<{ collections: RawCollection[] }>(
      'GET',
      `/collections?workspace=${encodeURIComponent(input.workspaceId)}`,
    )
    const match = raw.collections.find((c) => c.name === input.name)
    return match ? mapCollection(match) : null
  }

  async deleteCollection(collectionId: string): Promise<void> {
    await this.request('DELETE', `/collections/${encodeURIComponent(collectionId)}`)
  }

  async importOpenApi(input: { workspaceId: string; spec: unknown }): Promise<PostmanCollection> {
    // Postman's import endpoint accepts the spec as a JSON-stringified
    // body under the `input` field. The workspace is selected via the
    // query string, not the request body.
    const raw = await this.request<{ collections: RawCollection[] }>(
      'POST',
      `/import/openapi?workspace=${encodeURIComponent(input.workspaceId)}`,
      {
        type: 'string',
        input: JSON.stringify(input.spec),
      },
    )
    const created = raw.collections[0]
    if (!created) {
      throw new ProviderApiError(
        'postman',
        500,
        'postman returned no collection on import — check the OpenAPI spec is well-formed',
      )
    }
    return mapCollection(created)
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'X-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new ProviderApiError('postman', response.status, text)
    }
    if (response.status === 204) return undefined as T
    const text = await response.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  }
}

// ─── raw response shapes ─────────────────────────────────────────────

interface RawUser {
  id: number
  username: string
  fullName: string
}

interface RawWorkspace {
  id: string
  name: string
  type: string
}

interface RawCollection {
  id: string
  uid: string
  name: string
}

function mapUser(raw: RawUser): PostmanUser {
  return { id: raw.id, username: raw.username, fullName: raw.fullName }
}

function mapWorkspace(raw: RawWorkspace): PostmanWorkspace {
  return { id: raw.id, name: raw.name, type: raw.type as PostmanWorkspace['type'] }
}

function mapCollection(raw: RawCollection): PostmanCollection {
  return { id: raw.id, uid: raw.uid, name: raw.name }
}
