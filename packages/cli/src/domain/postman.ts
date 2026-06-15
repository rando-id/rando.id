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
}
