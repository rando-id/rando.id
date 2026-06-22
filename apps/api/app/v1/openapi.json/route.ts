// Generated OpenAPI spec — single source of truth for any downstream
// tooling (Postman, Swagger UI, client codegen, etc.).
//
// @ts-rest/open-api walks the contract and emits a 3.x spec with each
// route's method/path/query/body/responses pulled straight from the
// zod schemas. We then enrich + refify the output:
//   - lift named zod schemas into `components.schemas`
//   - replace matching inline schemas with `$ref`s (fingerprint match)
//   - replace standard 4xx/5xx responses with refs to named components
//   - declare tags, securitySchemes, and per-route security
//
// Drift between the contract and the spec is impossible by design.

import { NextResponse } from 'next/server'
import { generateOpenApi } from '@ts-rest/open-api'
import { generateSchema } from '@anatine/zod-openapi'
import { contract } from '@rando/api-client'
import {
  AddMemberBody,
  AvatarKind,
  ContactListItem,
  ContactLocation,
  ContactSort,
  CreateContactBody,
  CreateListBody,
  ErrorBody as ErrorBodyZod,
  ListItem,
  ListKind,
  ListWithMembers,
  PatchContactBody,
  PatchListBody,
} from '@rando/api-client/contract'

// Edge runtime: the generator is pure (no I/O), so cold-start is the
// dominant cost and edge is faster on that.
export const runtime = 'edge'

// ─── tags ───────────────────────────────────────────────────────────

const TAGS = [
  { name: 'Health', description: 'Liveness + identity checks (unauthenticated).' },
  { name: 'Contacts', description: 'Create, read, and update a user’s contacts.' },
  { name: 'Lists', description: 'Custom lists of contacts and their members.' },
] as const

// ─── schemas → components ───────────────────────────────────────────
// Named zod schemas exported from @rando/api-client/contract.ts get
// converted via @anatine/zod-openapi (the same converter @ts-rest/open-api
// uses internally — guarantees byte-equivalent output that the refify
// pass below can fingerprint-match against inline schemas in operations).
//
// ErrorBody is the one schema we DON'T derive from zod here — the spec
// already had a hand-written version (with richer field descriptions),
// so we keep it for the docs benefit. The fingerprint pass still works
// because routes don't currently inline anything matching ErrorBody's
// shape exactly — they use it via the named component already.

const NAMED_ZOD_SCHEMAS = {
  ContactLocation,
  AvatarKind,
  ContactListItem,
  CreateContactBody,
  PatchContactBody,
  ContactSort,
  ListKind,
  ListItem,
  ListWithMembers,
  CreateListBody,
  PatchListBody,
  AddMemberBody,
} as const

const COMPONENT_SCHEMAS: Record<string, unknown> = {
  // Hand-authored — richer field docs than the zod converter would emit.
  ErrorBody: {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'string',
        description: 'Short, human-readable error message — safe to log + display.',
      },
      issues: {
        type: 'array',
        description: 'Per-field zod validation issues when applicable (400 only).',
        items: {},
      },
    },
  },
}
for (const [name, zodSchema] of Object.entries(NAMED_ZOD_SCHEMAS)) {
  COMPONENT_SCHEMAS[name] = generateSchema(zodSchema)
}

// Fingerprint map: canonicalized JSON of each component schema → ref path.
// Used by the refify pass to spot equivalent inline schemas in
// operations and rewrite them as $refs. The ErrorBody hand-written
// shape doesn't need to match anything inline (operations reference
// ErrorBody only via components.responses).
const FINGERPRINT_TO_REF = new Map<string, string>()
for (const [name, schema] of Object.entries(COMPONENT_SCHEMAS)) {
  if (name === 'ErrorBody') continue
  const fp = canonicalize(schema)
  if (FINGERPRINT_TO_REF.has(fp)) {
    // Two named schemas have identical canonical JSON — last-write-wins
    // would silently drop one. Surfacing this in dev avoids ambiguous
    // $ref behavior; the fix is to disambiguate via `.describe()` or
    // a structural difference on one of the zod schemas.
    throw new Error(
      `OpenAPI schema collision: ${name} has the same canonical fingerprint as ${FINGERPRINT_TO_REF.get(fp)}. ` +
        `Differentiate them (e.g. add a description) in @rando/api-client/contract.ts.`,
    )
  }
  FINGERPRINT_TO_REF.set(fp, `#/components/schemas/${name}`)
}

// Refify the components themselves so nested schemas (e.g. AvatarKind
// inside ContactListItem) pick up $refs to their own component
// definitions instead of staying inline. Without this pass, lifted
// schemas that only appear nested in another schema look "unused" to
// spec linters even though they're conceptually part of the contract.
//
// Self-match guard: a schema can't $ref itself, so we exclude its own
// fingerprint from the lookup table while refifying it.
for (const name of Object.keys(COMPONENT_SCHEMAS)) {
  if (name === 'ErrorBody') continue
  const own = canonicalize(COMPONENT_SCHEMAS[name])
  const withoutSelf = new Map(FINGERPRINT_TO_REF)
  withoutSelf.delete(own)
  COMPONENT_SCHEMAS[name] = refifyWith(COMPONENT_SCHEMAS[name], withoutSelf)
}

// ─── security ───────────────────────────────────────────────────────

const SECURITY_SCHEMES = {
  bearerAuth: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'Clerk-issued session JWT. Frontend obtains it via `clerk.session.getToken()` and forwards as `Authorization: Bearer <token>`. Validated server-side by `requireCurrentUser`.',
  },
} as const

// ─── named responses ────────────────────────────────────────────────
// Each named response references `components.schemas.ErrorBody` via
// $ref so the schema and the response wrapper stay decoupled.

const ERROR_RESPONSE_REF = {
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
  },
} as const

const RESPONSES = {
  Unauthorized: {
    description: 'Missing or invalid Clerk session JWT.',
    ...ERROR_RESPONSE_REF,
  },
  NotFound: {
    description:
      'Requested resource does not exist OR is owned by a different user (handlers conflate the two on purpose so cross-tenant existence isn’t leaked).',
    ...ERROR_RESPONSE_REF,
  },
  BadRequest: {
    description:
      'Request body or query parameters failed zod validation. `issues[]` carries the per-field detail.',
    ...ERROR_RESPONSE_REF,
  },
  ServerError: {
    description:
      'Unexpected server error — typically a database constraint violation or downstream timeout. Safe to retry on a backoff.',
    ...ERROR_RESPONSE_REF,
  },
} as const

// HTTP status → response component name. Inline 4xx/5xx error
// responses get rewritten to $refs against these.
const STATUS_TO_RESPONSE_REF: Record<string, string> = {
  '400': '#/components/responses/BadRequest',
  '401': '#/components/responses/Unauthorized',
  '404': '#/components/responses/NotFound',
  '500': '#/components/responses/ServerError',
}

// Whitespace + arbitrary `ErrorBody`-shaped inline schema (legal since
// ts-rest uses the zod converter): if a response body schema matches
// this shape we treat it as an error envelope and accept the status-code
// override. Otherwise (e.g. 200 with a happy-path schema) leave alone.
const ERROR_BODY_FINGERPRINT = canonicalize(generateSchema(ErrorBodyZod))

// ─── per-route metadata helpers ─────────────────────────────────────

function tagForPath(path: string): string | null {
  if (path.startsWith('/v1/health')) return 'Health'
  if (path.startsWith('/v1/contacts')) return 'Contacts'
  if (path.startsWith('/v1/lists')) return 'Lists'
  return null
}

function securityForPath(path: string): Array<Record<string, string[]>> | undefined {
  if (path.startsWith('/v1/health')) return []
  return undefined // inherit top-level default
}

// ─── handler ────────────────────────────────────────────────────────

export function GET(): NextResponse {
  const spec = generateOpenApi(
    contract,
    {
      info: {
        title: 'Rando API',
        version: '0.0.0',
        description:
          'Auto-generated from the ts-rest contract in @rando/api-client. Edit the contract, not this output.',
      },
      servers: [
        { url: 'https://api.rando.id', description: 'Production' },
        { url: 'http://localhost:4000', description: 'Local dev' },
      ],
      tags: [...TAGS],
      components: {
        schemas: COMPONENT_SCHEMAS,
        securitySchemes: SECURITY_SCHEMES,
        responses: RESPONSES,
      },
      security: [{ bearerAuth: [] }],
    },
    {
      setOperationId: true,
      operationMapper: (operation, appRoute) => {
        const tag = tagForPath(appRoute.path)
        const security = securityForPath(appRoute.path)

        // Refify: schemas first, then error responses. Order matters
        // because the error-response rewrite drops the inline schema
        // entirely (replaced by a `$ref` to the named response), so we
        // want to do the schema-ref pass before that to preserve any
        // accidental ErrorBody match in happy-path responses (unlikely
        // but possible).
        const withRefs = refifySchemas(operation) as Record<string, unknown>
        const responses = refifyErrorResponses(
          (withRefs.responses ?? {}) as Record<string, unknown>,
        )

        return {
          ...(withRefs as object),
          responses,
          ...(tag ? { tags: [tag] } : {}),
          ...(security !== undefined ? { security } : {}),
        }
      },
    },
  )
  return NextResponse.json(spec)
}

// ─── refify helpers ─────────────────────────────────────────────────

/**
 * Walk a value recursively; replace any object whose canonical JSON
 * fingerprint matches a known named schema with `{ $ref: '...' }`.
 *
 * Non-matching objects get their children walked. Arrays + primitives
 * pass through unchanged. The fingerprint comparison is exact — slight
 * differences (extra `description`, `nullable: true` vs `[T,null]`)
 * will miss; that's intentional, false-positive refs would be worse.
 */
function refifySchemas(value: unknown): unknown {
  return refifyWith(value, FINGERPRINT_TO_REF)
}

/**
 * Same as refifySchemas but with an explicit fingerprint map. Used by
 * the components self-refify pass, which needs to exclude each
 * schema's own fingerprint (a schema can't $ref itself).
 *
 * Two match modes:
 *   1. Exact: object fingerprint == a component → `{ $ref }`
 *   2. Nullable: `{ nullable: true, ...rest }` and `rest` matches a
 *      component → `{ nullable: true, allOf: [{ $ref }] }`. The
 *      `allOf` is required in OpenAPI 3.0 because a `$ref` sibling
 *      of `nullable` is undefined behavior (refs override siblings);
 *      `allOf` is the documented escape hatch.
 */
function refifyWith(value: unknown, fingerprints: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => refifyWith(v, fingerprints))
  if (value && typeof value === 'object') {
    const ref = fingerprints.get(canonicalize(value))
    if (ref) return { $ref: ref }

    const obj = value as Record<string, unknown>
    if (obj.nullable === true) {
      const { nullable: _nullable, ...rest } = obj
      const innerRef = fingerprints.get(canonicalize(rest))
      if (innerRef) return { nullable: true, allOf: [{ $ref: innerRef }] }
    }

    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = refifyWith(v, fingerprints)
    return out
  }
  return value
}

/**
 * Replace inline 4xx/5xx error responses with $refs to the named
 * components. Match criteria: status code is one we have a named
 * response for AND the response's content schema fingerprints to
 * `ErrorBody`. The second check avoids accidentally re-pointing a
 * happy-path 400 (none exist today, but the guard keeps us honest).
 */
function refifyErrorResponses(responses: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [status, response] of Object.entries(responses)) {
    const ref = STATUS_TO_RESPONSE_REF[status]
    if (ref && isErrorBodyResponse(response)) {
      out[status] = { $ref: ref }
      continue
    }
    out[status] = response
  }
  return out
}

function isErrorBodyResponse(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false
  const r = response as { content?: Record<string, { schema?: unknown }> }
  const schema = r.content?.['application/json']?.schema
  if (!schema) return false
  return canonicalize(schema) === ERROR_BODY_FINGERPRINT
}

/**
 * Canonical JSON: sort object keys recursively before stringifying so
 * two structurally identical objects produce byte-equal strings.
 */
function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k]
      }
      return sorted
    }
    return v
  })
}
