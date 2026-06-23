// Vendor-neutral API testing/collection surface. Adapters (Postman,
// future Bruno/Insomnia) compose their own fine-grained interfaces
// (`PostmanProvider`, etc.) into the high-level operations below.
//
// The design rule: this interface only carries operations every
// reasonable api-testing tool supports. Concepts that are vendor-
// specific (Postman workspaces, Spec Hub, API Builder entities; Bruno's
// `.bru` filesystem layout; Insomnia workspace exports) live on the
// concrete adapter and aren't exposed through `ApiCollectionProvider`.
//
// `target` is an opaque, adapter-defined identifier — workspaceId for
// Postman, directory path for Bruno, workspace-export path for
// Insomnia. Commands that need to surface the target in user-facing
// output should pass through whatever the user supplied (flag or
// config) without trying to interpret it.

export interface ApiTestingIdentity {
  /**
   * Human-readable identifier — "@cnewton (Chris Newton)" for Postman,
   * "local filesystem" for Bruno, etc. Doctor / spinner messages render
   * this as-is.
   */
  display: string
}

export interface SyncCollectionInput {
  /**
   * Adapter-defined target. Postman: workspaceId. Bruno: directory.
   * Insomnia: workspace-export path. Opaque to the caller.
   */
  target: string
  /** Display name for the collection in the tool's UI. */
  name: string
  /**
   * The parsed OpenAPI spec object. Adapters serialize when they need
   * a string. Pass the parsed object so adapters can introspect (e.g.
   * Postman reads info.title for fallback naming).
   */
  spec: unknown
}

export interface SyncCollectionResult {
  /** True when a previous collection of the same name was replaced. */
  replaced: boolean
  /**
   * Display name the tool ended up assigning. May differ from the
   * `name` in `SyncCollectionInput` — Postman, for instance, reads
   * `info.title` from the OpenAPI spec and uses it verbatim if the
   * caller didn't override. Surface this back so JSON consumers and
   * human-readable output report what's actually live, not what was
   * requested.
   */
  name: string
  /** Direct URL into the vendor UI when available; undefined for offline tools. */
  url?: string
  /** Adapter-defined stable id (Postman uid, Bruno file path, etc.). */
  ref: string
}

/**
 * High-level interface every api-testing adapter implements. Commands
 * that don't care which vendor is active should consume this — the
 * `Adapters.apiTesting()` factory in `config.ts` dispatches on
 * `cfg.testing.api.kind`. For vendor-specific behavior (e.g. Postman's
 * workspace picker in `rando init`), reach for the concrete adapter
 * via its own factory (`Adapters.postman()`) instead.
 */
export interface ApiCollectionProvider {
  /**
   * Verify the provider is reachable and configured. Throws on auth /
   * connectivity failure with a message safe to surface to the user.
   */
  verifyAuth(): Promise<ApiTestingIdentity>

  /**
   * Push the OpenAPI spec into the tool as a derived collection.
   * Idempotent — a previous collection with the same name is replaced.
   * The adapter owns the find/delete/import orchestration; callers
   * just supply the spec.
   */
  syncCollectionFromSpec(input: SyncCollectionInput): Promise<SyncCollectionResult>
}
