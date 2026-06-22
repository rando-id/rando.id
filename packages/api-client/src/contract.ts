// Single source of truth for the Rando REST API.
//
// Every endpoint is defined once here and referenced from:
//   - apps/api (handlers — `@ts-rest/serverless/next`)
//   - this package's generated typed client (phase D)
//   - apps/api/app/v1/openapi.json (`@ts-rest/open-api` → spec, phase E)
//
// Note on /v1/webhooks/clerk: the Svix signature header is verified
// against the raw request body, which requires raw-body access that
// doesn't fit the typed-contract model cleanly. That route stays as a
// hand-rolled Next handler — documented as the lone exception.

import { initContract } from '@ts-rest/core'
import { z } from 'zod'

const c = initContract()

// ─── shared schemas ──────────────────────────────────────────────────
// Exported so the OpenAPI spec generator (apps/api/app/v1/openapi.json)
// can lift them into `components.schemas` and the operations can
// `$ref` them instead of inlining. Local routes still consume the
// zod schemas directly via the contract router below.

export const ContactLocation = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  meters: z.number(),
})

export const AvatarKind = z.enum(['photo', 'gravatar', 'monogram', 'emoji', 'random'])

export const ContactListItem = z.object({
  id: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  avatarKind: AvatarKind,
  avatarValue: z.string().nullable(),
  favorite: z.boolean(),
  promoted: z.boolean(),
  location: ContactLocation.nullable(),
})

export const CreateContactBody = z.object({
  firstName: z.string().trim().min(1).max(120).nullish(),
  lastName: z.string().trim().min(1).max(120).nullish(),
  company: z.string().trim().max(160).nullish(),
  notes: z.string().max(2000).nullish(),
  favorite: z.boolean().optional(),
  location: z.object({
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
    name: z.string().trim().min(1).max(160),
    address: z.string().max(400).nullish(),
  }),
  interaction: z
    .object({
      metAt: z.string().datetime().optional(),
      notes: z.string().max(2000).nullish(),
    })
    .optional(),
})

export const PatchContactBody = z
  .object({
    firstName: z.string().trim().min(1).max(120).nullable().optional(),
    lastName: z.string().trim().min(1).max(120).nullable().optional(),
    company: z.string().trim().max(160).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    favorite: z.boolean().optional(),
  })
  .strict()

export const ContactSort = z.enum(['distance', 'last_name', 'date_added', 'date_updated'])

export const ListKind = z.enum(['custom', 'location', 'group', 'favorites', 'promoted'])

export const ListItem = z.object({
  id: z.string(),
  name: z.string(),
  kind: ListKind,
  coverImage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  memberCount: z.number(),
})

export const ListWithMembers = ListItem.extend({
  members: z.array(ContactListItem),
})

export const CreateListBody = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict()
  .describe('Request body for POST /v1/lists — create a new custom list.')
export const PatchListBody = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict()
  .describe('Request body for PATCH /v1/lists/:id — rename an existing list.')
export const AddMemberBody = z.object({ contactId: z.string().uuid() }).strict()

export const ErrorBody = z.object({
  error: z.string(),
  issues: z.array(z.unknown()).optional(),
})

// ─── response types re-exported for consumers ────────────────────────
// Keep the public type names stable so apps/web and apps/native hooks
// don't need touching.

export type ContactListItem = z.infer<typeof ContactListItem>
export type CreateContactInput = z.infer<typeof CreateContactBody>
export type UpdateContactInput = z.infer<typeof PatchContactBody>
export type CreateContactResult = {
  contact: ContactListItem
  locationReused: boolean
}

// ─── contracts ───────────────────────────────────────────────────────

export const contract = c.router({
  health: {
    method: 'GET',
    path: '/v1/health',
    summary: 'Liveness check',
    description: 'Public, unauthenticated. Returns service identity + timestamp.',
    responses: {
      200: z.object({
        ok: z.literal(true),
        service: z.string(),
        version: z.string(),
        timestamp: z.string(),
      }),
    },
  },

  listContacts: {
    method: 'GET',
    path: '/v1/contacts',
    summary: 'List contacts for the authenticated user',
    description:
      'Returns contacts sorted by distance from `near` (lat,lng) when provided, otherwise alphabetically by last name. Supports filtering by favorites, list membership, and a free-text query.',
    query: z.object({
      near: z.string().optional(),
      // Query params are always strings on the wire. Adapter compares
      // against 'true' rather than .transform() so the client request
      // type stays string (avoids zod input vs output divergence).
      favorites: z.string().optional(),
      list: z.string().optional(),
      q: z.string().optional(),
      sort: ContactSort.optional(),
    }),
    responses: {
      200: z.array(ContactListItem),
      401: ErrorBody,
    },
  },

  createContact: {
    method: 'POST',
    path: '/v1/contacts',
    summary: 'Create a contact + location + first interaction in one tx',
    description:
      'Compound endpoint: creates the location (with 50m PostGIS dedup), the contact, and the first interaction in a single DB transaction. At least one of firstName/lastName/company is required.',
    body: CreateContactBody,
    responses: {
      201: z.object({
        contact: ContactListItem,
        locationReused: z.boolean(),
      }),
      400: ErrorBody,
      401: ErrorBody,
      500: ErrorBody,
    },
  },

  getContact: {
    method: 'GET',
    path: '/v1/contacts/:id',
    summary: 'Fetch one contact by id',
    description:
      'Owner-scoped — returns 404 if the contact does not exist OR is owned by a different user.',
    pathParams: z.object({ id: z.string() }),
    query: z.object({ near: z.string().optional() }),
    responses: {
      200: ContactListItem,
      404: ErrorBody,
    },
  },

  updateContact: {
    method: 'PATCH',
    path: '/v1/contacts/:id',
    summary: 'Partial update of mutable contact fields',
    description:
      'Strict zod — unknown fields are rejected. Returns the updated contact (with distance from `near` if provided).',
    pathParams: z.object({ id: z.string() }),
    query: z.object({ near: z.string().optional() }),
    body: PatchContactBody,
    responses: {
      200: ContactListItem,
      400: ErrorBody,
      404: ErrorBody,
    },
  },

  listLists: {
    method: 'GET',
    path: '/v1/lists',
    summary: "List the user's custom lists",
    description: 'Returns ListItem rows ordered by creation date ASC. memberCount is precomputed.',
    responses: {
      200: z.array(ListItem),
    },
  },

  createList: {
    method: 'POST',
    path: '/v1/lists',
    summary: 'Create a new custom list',
    body: CreateListBody,
    responses: {
      201: ListItem,
      400: ErrorBody,
    },
  },

  getList: {
    method: 'GET',
    path: '/v1/lists/:id',
    summary: 'Fetch one list + its members',
    description:
      'Owner-scoped. Members are returned as ContactListItem rows, distance-sorted from `near` when provided.',
    pathParams: z.object({ id: z.string() }),
    query: z.object({ near: z.string().optional() }),
    responses: {
      200: ListWithMembers,
      404: ErrorBody,
    },
  },

  updateList: {
    method: 'PATCH',
    path: '/v1/lists/:id',
    summary: 'Rename a list',
    pathParams: z.object({ id: z.string() }),
    body: PatchListBody,
    responses: {
      200: ListItem,
      400: ErrorBody,
      404: ErrorBody,
    },
  },

  deleteList: {
    method: 'DELETE',
    path: '/v1/lists/:id',
    summary: 'Delete a list (cascades to list_members)',
    pathParams: z.object({ id: z.string() }),
    body: z.unknown().optional(),
    responses: {
      200: z.object({ ok: z.literal(true) }),
      404: ErrorBody,
    },
  },

  addListMember: {
    method: 'POST',
    path: '/v1/lists/:id/members',
    summary: 'Add a contact to a list',
    description:
      'Idempotent — `added=false` covers both "already a member" and "list/contact not owned by user". Caller decides whether to show a toast.',
    pathParams: z.object({ id: z.string() }),
    body: AddMemberBody,
    responses: {
      200: z.object({ ok: z.literal(true), added: z.boolean() }),
      400: ErrorBody,
    },
  },

  removeListMember: {
    method: 'DELETE',
    path: '/v1/lists/:id/members/:contactId',
    summary: 'Remove a contact from a list',
    pathParams: z.object({ id: z.string(), contactId: z.string() }),
    body: z.unknown().optional(),
    responses: {
      200: z.object({ ok: z.literal(true) }),
      404: ErrorBody,
    },
  },
})

export type Contract = typeof contract
