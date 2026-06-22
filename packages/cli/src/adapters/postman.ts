// Postman REST API implementation of PostmanProvider.
//
// API reference: https://learning.postman.com/docs/developer/postman-api/
// Auth: `X-Api-Key: <api-key>` header (no Bearer prefix). The key is
// per-user, generated at https://web.postman.co/settings/me/api-keys.
//
// Endpoints we touch:
//   GET    /me                                                → user identity (for doctor)
//   GET    /workspaces                                        → list workspaces (for init)
//   GET    /collections?workspace=…                           → list a workspace's collections
//   DELETE /collections/{uid}                                 → remove an old collection on re-sync
//   POST   /import/openapi                                    → create a fresh collection from a spec
//   GET    /apis?workspaceId=…                                → list a workspace's APIs (spec entities)
//   POST   /apis                                              → create a new API entity
//   GET    /apis/{id}/versions                                → list versions on an API
//   POST   /apis/{id}/versions                                → create a version (e.g. "v1")
//   GET    /apis/{id}/versions/{v}/schemas                    → list schemas on a version
//   POST   /apis/{id}/versions/{v}/schemas                    → create a schema (OpenAPI JSON)
//   PUT    /apis/{id}/versions/{v}/schemas/{s}                → replace an existing schema
//   GET    /specs?workspaceId=…                               → list Spec Hub specs
//   POST   /specs?workspaceId=…                               → create a new Spec Hub spec
//   PATCH  /specs/{id}/files/{filePath}                       → replace a spec file's content
//
// We chose delete-and-recreate over hunting for a stable update path
// because Postman's "API Builder" stable-id workflow is much more
// complex and changing under our feet. Trade-off is the collection ID
// changes per sync; documented in the domain interface.
//
// For API and Spec entities we DO keep the id stable: future
// Postman-anchored tooling (governance rules, share-by-id links)
// references the entity id. The adapter creates on first push and
// updates the file content on subsequent ones.

import { PostmanPlanLimitError, ProviderApiError } from '../domain/errors'
import type {
  PostmanApi,
  PostmanCollection,
  PostmanEnvironment,
  PostmanProvider,
  PostmanSpec,
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

  async createCollection(input: {
    workspaceId: string
    collection: unknown
  }): Promise<PostmanCollection> {
    // POST /collections with `?workspace=<id>` puts the new collection
    // into the right workspace. Body shape is `{ collection: <v2.1 json> }`.
    const raw = await this.request<{ collection: RawCollection }>(
      'POST',
      `/collections?workspace=${encodeURIComponent(input.workspaceId)}`,
      { collection: input.collection },
    )
    return mapCollection(raw.collection)
  }

  async updateCollection(input: { uid: string; collection: unknown }): Promise<PostmanCollection> {
    const raw = await this.request<{ collection: RawCollection }>(
      'PUT',
      `/collections/${encodeURIComponent(input.uid)}`,
      { collection: input.collection },
    )
    return mapCollection(raw.collection)
  }

  async listEnvironments(input: { workspaceId: string }): Promise<PostmanEnvironment[]> {
    const raw = await this.request<{ environments: RawEnvironment[] }>(
      'GET',
      `/environments?workspace=${encodeURIComponent(input.workspaceId)}`,
    )
    return raw.environments.map(mapEnvironment)
  }

  async findEnvironmentByName(input: {
    workspaceId: string
    name: string
  }): Promise<PostmanEnvironment | null> {
    const envs = await this.listEnvironments(input)
    return envs.find((e) => e.name === input.name) ?? null
  }

  async createEnvironment(input: {
    workspaceId: string
    environment: unknown
  }): Promise<PostmanEnvironment> {
    const raw = await this.request<{ environment: RawEnvironment }>(
      'POST',
      `/environments?workspace=${encodeURIComponent(input.workspaceId)}`,
      { environment: input.environment },
    )
    return mapEnvironment(raw.environment)
  }

  async updateEnvironment(input: {
    uid: string
    environment: unknown
  }): Promise<PostmanEnvironment> {
    const raw = await this.request<{ environment: RawEnvironment }>(
      'PUT',
      `/environments/${encodeURIComponent(input.uid)}`,
      { environment: input.environment },
    )
    return mapEnvironment(raw.environment)
  }

  async findApiByName(input: { workspaceId: string; name: string }): Promise<PostmanApi | null> {
    // Note: this endpoint takes `workspaceId` (camelCase), not `workspace`
    // like /collections does. Postman's naming is inconsistent across
    // surfaces — verified against their public docs.
    const raw = await this.request<{ apis: RawApi[] }>(
      'GET',
      `/apis?workspaceId=${encodeURIComponent(input.workspaceId)}`,
    )
    const match = raw.apis.find((a) => a.name === input.name)
    return match ? mapApi(match) : null
  }

  async createApi(input: {
    workspaceId: string
    name: string
    summary?: string
  }): Promise<PostmanApi> {
    const raw = await this.request<{ api: RawApi }>('POST', '/apis', {
      api: {
        name: input.name,
        summary: input.summary,
        workspaceId: input.workspaceId,
      },
    })
    return mapApi(raw.api)
  }

  async upsertApiSchema(input: { apiId: string; version: string; spec: unknown }): Promise<void> {
    // Two lookups + at most two writes:
    //   1. find-or-create the version (matched by name, e.g. "v1")
    //   2. find-or-create the schema on that version (one schema per version)
    // Postman returns the new IDs on creation, so the second call doesn't
    // need to re-list on the create path.
    const versionId = await this.findOrCreateVersion(input.apiId, input.version)
    const schemas = await this.request<{ schemas: RawSchema[] }>(
      'GET',
      `/apis/${encodeURIComponent(input.apiId)}/versions/${encodeURIComponent(versionId)}/schemas`,
    )
    const body = {
      schema: {
        type: 'openapi3',
        language: 'json',
        schema: typeof input.spec === 'string' ? input.spec : JSON.stringify(input.spec),
      },
    }
    const existing = schemas.schemas[0]
    if (existing) {
      await this.request(
        'PUT',
        `/apis/${encodeURIComponent(input.apiId)}/versions/${encodeURIComponent(versionId)}/schemas/${encodeURIComponent(existing.id)}`,
        body,
      )
      return
    }
    await this.request(
      'POST',
      `/apis/${encodeURIComponent(input.apiId)}/versions/${encodeURIComponent(versionId)}/schemas`,
      body,
    )
  }

  private async findOrCreateVersion(apiId: string, name: string): Promise<string> {
    const list = await this.request<{ versions: RawVersion[] }>(
      'GET',
      `/apis/${encodeURIComponent(apiId)}/versions`,
    )
    const match = list.versions.find((v) => v.name === name)
    if (match) return match.id
    const created = await this.request<{ version: RawVersion }>(
      'POST',
      `/apis/${encodeURIComponent(apiId)}/versions`,
      { version: { name } },
    )
    return created.version.id
  }

  async findSpecByName(input: { workspaceId: string; name: string }): Promise<PostmanSpec | null> {
    const raw = await this.request<{ specs: RawSpec[] }>(
      'GET',
      `/specs?workspaceId=${encodeURIComponent(input.workspaceId)}`,
    )
    const match = raw.specs.find((s) => s.name === input.name)
    return match ? mapSpec(match) : null
  }

  async createSpec(input: {
    workspaceId: string
    name: string
    type?: string
    filePath?: string
    fileContent: string
  }): Promise<PostmanSpec> {
    // Endpoint shape verified empirically (Postman's public docs don't
    // currently cover this path):
    //   POST /specs?workspaceId=<id>
    //   body: { name, type, files: [{path, content}] }
    //   response 201: { id, name, type, ... }
    // Required fields are flat — name and type are NOT wrapped under
    // a `spec` key (unlike POST /apis which DOES wrap under `api`).
    const raw = await this.request<RawSpec>(
      'POST',
      `/specs?workspaceId=${encodeURIComponent(input.workspaceId)}`,
      {
        name: input.name,
        type: input.type ?? 'OPENAPI:3.0',
        files: [
          {
            path: input.filePath ?? 'index.json',
            content: input.fileContent,
          },
        ],
      },
    )
    return mapSpec(raw)
  }

  async upsertSpecFile(input: {
    specId: string
    filePath: string
    content: string
  }): Promise<void> {
    // PATCH (not PUT — PUT returns 404 on this surface, verified
    // empirically). Body holds only the new content; path identifies
    // the file. Postman returns the file metadata; we discard it
    // since callers only need the side-effect.
    await this.request(
      'PATCH',
      `/specs/${encodeURIComponent(input.specId)}/files/${encodeURIComponent(input.filePath)}`,
      { content: input.content },
    )
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
      // Plan-limit responses come back as 4xx with a specific JSON
      // shape — tag them so commands can render "upgrade required"
      // instead of dumping the raw body. Free-tier "0 APIs" is the
      // first instance; any future paid-feature gate should land here
      // too as long as Postman keeps the `limitReachedError` name.
      const limit = detectPlanLimit(text)
      if (limit) throw new PostmanPlanLimitError(limit, text)
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

interface RawEnvironment {
  id: string
  uid: string
  name: string
}

interface RawApi {
  id: string
  name: string
}

interface RawVersion {
  id: string
  name: string
}

interface RawSchema {
  id: string
}

interface RawSpec {
  id: string
  name: string
  type: string
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

function mapEnvironment(raw: RawEnvironment): PostmanEnvironment {
  return { id: raw.id, uid: raw.uid, name: raw.name }
}

function mapApi(raw: RawApi): PostmanApi {
  return { id: raw.id, name: raw.name }
}

function mapSpec(raw: RawSpec): PostmanSpec {
  return { id: raw.id, name: raw.name, type: raw.type }
}

/**
 * Inspect a Postman error body for the plan-limit shape. Returns the
 * human-readable limit message (e.g. "You can create up to 0 APIs on
 * your current plan.") when matched, otherwise null. JSON-parse
 * failures fall through to null — only well-formed plan-limit bodies
 * get the special-case treatment.
 */
function detectPlanLimit(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { name?: string; message?: string } }
    if (parsed.error?.name === 'limitReachedError' && parsed.error.message) {
      return parsed.error.message
    }
  } catch {
    // not JSON or unexpected shape — fall through
  }
  return null
}
