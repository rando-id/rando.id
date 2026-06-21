// Postman API integration. Imports the auto-generated OpenAPI spec
// from /v1/openapi.json into a Postman workspace as a collection so
// API-only work doesn't need a UI deploy round-trip.
//
// The current sync strategy is delete-and-recreate: find the previous
// collection by name (or by id stored in rando.config.json), delete it,
// import the new spec. The collection ID changes per sync — documented
// for callers. Trade-off is simplicity vs. ID stability; we trade
// stability because Postman's public API doesn't expose a clean
// "update collection from OpenAPI" path.

export interface PostmanUser {
  id: number
  username: string
  fullName: string
}

export interface PostmanWorkspace {
  id: string
  name: string
  type: 'personal' | 'team' | 'private' | 'public' | 'partner' | string
}

export interface PostmanCollection {
  id: string
  /** UID used by `postman collection run`; format is `<owner>-<id>`. */
  uid: string
  name: string
}

export interface PostmanEnvironment {
  id: string
  uid: string
  name: string
}

/**
 * Postman "API" entity — the spec-shaped view in the Postman sidebar.
 * Separate from PostmanCollection: a collection is a list of requests
 * (what the Postman runner executes); an API is the OpenAPI spec the
 * collection was derived from (what governance / docs / mocks anchor
 * to). Both can co-exist in the same workspace pointing at the same
 * source.
 */
export interface PostmanApi {
  id: string
  name: string
}

export interface SyncResult {
  collection: PostmanCollection
  /** True when a previous collection was deleted before this import. */
  replaced: boolean
  /** Direct URL to the collection in the Postman UI. */
  url: string
}

export interface PostmanProvider {
  /** Verify auth + return the authenticated user. */
  getMyself(): Promise<PostmanUser>

  /** List the user's workspaces. Used by init's workspace picker. */
  listWorkspaces(): Promise<PostmanWorkspace[]>

  /**
   * Find a collection by name within a workspace. Returns null when no
   * match exists — used to detect a previous sync to delete + replace.
   */
  findCollectionByName(input: {
    workspaceId: string
    name: string
  }): Promise<PostmanCollection | null>

  /** Delete a collection by id. */
  deleteCollection(collectionId: string): Promise<void>

  /**
   * Import an OpenAPI spec as a new collection in the given workspace.
   * Returns the newly-created collection.
   */
  importOpenApi(input: {
    workspaceId: string
    /** Full OpenAPI spec object — the adapter JSON-stringifies it. */
    spec: unknown
  }): Promise<PostmanCollection>

  /**
   * Create a collection from a local Postman v2.1 collection JSON
   * (the kind `rando api postman generate` writes). Use this when the
   * file has hand-authored pm.test() blocks that you want preserved in
   * Postman — importOpenApi can't carry those because it converts from
   * the spec, not from a collection.
   */
  createCollection(input: { workspaceId: string; collection: unknown }): Promise<PostmanCollection>

  /**
   * Replace an existing collection's contents while keeping its uid
   * stable. Stable uid matters because Postman Monitors / shared links
   * reference the uid; delete-and-recreate breaks those.
   */
  updateCollection(input: { uid: string; collection: unknown }): Promise<PostmanCollection>

  /** List environments in a workspace. */
  listEnvironments(input: { workspaceId: string }): Promise<PostmanEnvironment[]>

  /**
   * Find an environment by name within a workspace. Returns null when
   * no match exists — used by `push` to decide create vs update.
   */
  findEnvironmentByName(input: {
    workspaceId: string
    name: string
  }): Promise<PostmanEnvironment | null>

  /** Create a new environment from a local Postman environment JSON. */
  createEnvironment(input: {
    workspaceId: string
    environment: unknown
  }): Promise<PostmanEnvironment>

  /** Replace an existing environment, keeping uid stable. */
  updateEnvironment(input: { uid: string; environment: unknown }): Promise<PostmanEnvironment>

  /**
   * Find an API entity by name within a workspace. Returns null when
   * no match exists — used to decide create-vs-update on spec push.
   */
  findApiByName(input: { workspaceId: string; name: string }): Promise<PostmanApi | null>

  /**
   * Create a new API entity in the workspace. The schema is uploaded
   * separately via upsertApiSchema once the entity exists.
   */
  createApi(input: { workspaceId: string; name: string; summary?: string }): Promise<PostmanApi>

  /**
   * Add or replace the OpenAPI schema for a given API + version. Idempotent
   * on re-run: the adapter creates the version on first call and overwrites
   * the schema file on subsequent calls. Spec is JSON-stringified by the
   * adapter — pass the parsed object.
   */
  upsertApiSchema(input: { apiId: string; version: string; spec: unknown }): Promise<void>
}
