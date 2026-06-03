# Rando.id — Refined Specification

> Status: living document. Draft 1, 2026-06-02.

## 1. Product vision

A contacts application organized by **location**, not by name. The friction of conventional contact apps is that they require deliberate name+detail entry at the moment of meeting; the reality is that you accumulate repeated, casual encounters at recurring locations (your kid's baseball field, the park, the school pickup line) and never capture them. Rando.id makes the location the anchor and the person a child of that anchor, so "I don't remember her name but she's a baseball mom" is a sufficient search query.

### Differentiators
- Default sort is **distance from current location**, not alphabetical.
- Locations are first-class entities, with per-user nicknames over a shared canonical row.
- Designed mobile-first for capture-in-the-moment, with **offline-first** sync.

## 2. Locked technical decisions

| Layer | Choice | Notes |
|---|---|---|
| Web app | Next.js (App Router) | `apps/web` |
| Native app | Expo (managed) | `apps/native` |
| Admin app | Next.js | `apps/admin`, separate deploy |
| Shared UI | Tamagui | `packages/ui` |
| API surface | REST + OpenAPI, URL-versioned (`/v1`) | `apps/api` (Next.js, serverless on Vercel) |
| Auth | Clerk | Webhooks sync `users` table |
| Database | Postgres on Neon, PostGIS extension | Distance-to-location queries |
| ORM | Drizzle + Drizzle Kit migrations | |
| Sync engine | PowerSync | Local SQLite on every client, Postgres logical replication |
| Object storage | Vercel Blob | Signed upload URLs from API |
| Cache / rate limit | Upstash Redis | |
| Maps | OpenStreetMap (via MapLibre / Leaflet) | Adapter layer to swap to Mapbox later |
| Geocoding | Nominatim (OSM) initially | Adapter for swap |
| Observability | Sentry + Vercel logs + PostHog | |
| Payments | Stubbed `subscription_tier` enum, no provider yet | Stripe + RevenueCat once stable |
| API mocking | MSW (Storybook + Vitest + Playwright) | Handlers double as contract |
| Component dev | Storybook | Web target; native via on-device |
| E2E tests | Playwright with visual snapshots | Web only; native via Maestro later |
| Hosting | Vercel-first | Accepting lock-in for velocity |
| Monorepo | pnpm + Turborepo | |

## 3. Proposed monorepo layout

```
rando/
├── apps/
│   ├── web/            # Next.js — main user-facing web app
│   ├── native/         # Expo (iOS + Android)
│   ├── admin/          # Next.js — admin dashboard
│   └── api/            # Next.js — public REST/OpenAPI surface
├── packages/
│   ├── ui/             # Tamagui components shared between web + native
│   ├── api-client/     # Generated OpenAPI types + fetch client
│   ├── db/             # Drizzle schema + migrations + query helpers
│   ├── sync/           # PowerSync client wrappers + schema mirror
│   ├── auth/           # Clerk wrappers (web + native)
│   ├── maps/           # Map adapter (OSM today, Mapbox tomorrow)
│   ├── config/         # Themes, feature flags, env loaders
│   ├── observability/  # Sentry + PostHog + log wrappers
│   └── testing/        # MSW handlers, fixtures, Playwright helpers
├── tooling/
│   ├── eslint-config/
│   ├── tsconfig/
│   └── tailwind-preset/ (if used)
└── SPEC.md
```

## 4. Data model (v1 sketch)

```
users
  id, clerk_id, display_name, avatar_kind, avatar_value,
  subscription_tier ('free' | 'pro'), created_at, updated_at

locations  (canonical, shared)
  id, geo (PostGIS point), canonical_name, geocoded_address,
  source ('osm' | 'user'), created_at

location_aliases  (per-user override)
  id, location_id, user_id, nickname, notes

contacts  (owned by a user)
  id, owner_user_id, first_name, last_name, company,
  avatar_kind, avatar_value, favorite (bool), promoted (bool),
  notes, created_at, updated_at

contact_phones / contact_emails / contact_addresses / contact_socials / contact_pets
  multi-value child tables, each with (id, contact_id, label, value)

interactions  (the "I met this person here" event)
  id, contact_id, location_id, met_at, notes

lists
  id, owner_user_id, name, kind ('custom' | 'location' | 'group' | 'favorites' | 'promoted'),
  cover_image, created_at, updated_at

list_locations  (for kind='location')
  list_id, location_id

list_children   (for kind='group')
  parent_list_id, child_list_id

list_members
  list_id, contact_id, added_at

themes
  id, name, kind ('seasonal' | 'custom'), light_palette, dark_palette,
  active_from (nullable), active_to (nullable), is_paid

user_theme_prefs
  user_id, mode ('light' | 'dark' | 'system'),
  active_theme_id, auto_seasonal (bool, paid)
```

### Spatial query — "sort by closest"

```sql
select c.*, l.canonical_name,
  ST_Distance(l.geo, ST_MakePoint(:lon, :lat)::geography) as meters
from contacts c
join interactions i on i.contact_id = c.id
join locations l on l.id = i.location_id
where c.owner_user_id = :uid
order by meters asc;
```

PostGIS index on `locations.geo` (GIST) makes this near-constant time.

## 5. Feature scope by phase

### MVP (v0.1)
- Auth (sign up, sign in, profile)
- Create contact with location + map picker + photo (photos/upload/monogram/emoji)
- Contact list, sorted by current distance, with group headers (Top Name Matches / Other Results)
- Search/filter by name & list
- Sort options: distance, last name, date added, date updated
- Contact detail page
- Edit contact
- Lists (custom + location-based + favorites)
- Favorite a contact
- Add/remove from list, list edit-mode with trash/checkmark
- Light/dark/system + one default theme
- QR code share (vCard payload) — both display and scan
- Offline-first: read + write while disconnected, sync on reconnect

### v0.2
- Groups of lists
- Promoted list + one-way push to OS contacts (Expo Contacts on native; vCard download on web)
- Multiple themes (free tier gets 2; paid gets all)
- Settings: theme selection, app version, sign out, delete account
- Admin dashboard skeleton (users list, manual merge, basic counts)

### v0.3+
- Auto-theme by date range *(paid)*
- Random-design avatars *(paid)*
- Artist-curated lists *(paid)*
- Stripe (web) + RevenueCat (native) wired up
- Admin: location heatmap, user-edit flows, merge tooling
- WhatsApp deep-links (per-contact + per-list)
- Native contacts two-way sync (if user-validated)

## 6. Cross-cutting

### Themes
Two-layer system: `mode` (light/dark/system, per user) × `theme` (palette pack). Each theme exports both light and dark palettes. Tamagui themes feature handles this natively — we define theme packs at build time and the user's selection switches Tamagui's active theme at runtime.

### Avatars
Five variants: photo (uploaded to Vercel Blob), gravatar (resolve email → md5 hash → URL), monogram (computed from name initials + deterministic color), emoji (single grapheme), random-design (paid; generative seeded by user_id). Stored as `(avatar_kind, avatar_value)` — value semantics depend on kind.

### Sharing (QR code)
QR payload is a signed `https://rando.id/v/<token>` URL. Scanning navigates to the shared profile preview where the user can save as a contact. vCard export is the fallback for non-Rando recipients.

### Offline / sync semantics
- Every client (web + native) holds a SQLite mirror of the user's data via PowerSync.
- Reads always hit local SQLite. Writes are written locally and queued for sync.
- Conflict resolution: last-write-wins on individual fields, except `contact_phones`/`emails`/etc which are additive (sets, not merges).
- The REST API handles only: auth-adjacent endpoints, signed photo upload URLs, share-token resolution, payments (later), admin operations. Per-user CRUD goes through PowerSync.

### Privacy
- GPS coordinates are stored on `locations` (a shared resource), but a user's *visit history* (which locations they've created interactions at) is private to them.
- Admin heatmap aggregates at the location level — never per-user trails.
- Data deletion: cascade from `users` → contacts/interactions/lists. Locations are not deleted (they're shared).
- Retention: full data retained while subscription is active; 30 days post-cancellation, then hard delete.

### Observability
- Sentry: errors (web + native + API), tracing on API + web routes
- Vercel logs: structured JSON, retained 7 days
- PostHog: product events (contact_created, share_initiated, contact_favorited, etc.)
- Performance: Web Vitals via Vercel Analytics; native via Sentry performance

### Versioning
- API: URL-based (`/v1`, `/v2`). OpenAPI spec generated from route definitions; Postman collection generated from OpenAPI.
- DB: Drizzle migrations checked into `packages/db/migrations`. CI fails if migration plan is non-additive on a release branch.
- Apps: SemVer at package level; deploy artifacts tagged with git SHA + version.

## 7. Open questions / decisions deferred

- **Search**: Postgres full-text vs Typesense vs Algolia. Postgres is enough for MVP scale; revisit if relevance becomes a problem.
- **Notifications**: do we want push notifications? Use case unclear yet — probably "X is near you" but needs product thought.
- **Pets field**: confirm scope — is it just name + species, or do we want photo + dob + vet?
- **Theme editor for "custom" themes**: paid feature, but UX not designed.
- **Artist-curated lists**: needs a creator surface — who creates, how do they upload, how do users discover? Likely v0.3 design exercise.
- **WhatsApp specifics**: deep-linking is fine; "connect a list to a WhatsApp group" probably means storing the group's invite URL per list. Confirm scope.
- **Account merge UX**: a contact you've promoted might already exist as another contact you've created. Need a merge flow eventually.
- **Geocoding rate limits**: Nominatim has aggressive usage limits — need a serverside cache (Upstash) and probably a paid geocoder for production.
- **Map tiles**: free OSM tile servers throttle; will need to either self-host tiles or use a paid tile provider (Mapbox/Stadia/Protomaps) past MVP.

## 8. What's *not* in scope (yet)

- Group messaging / chat
- Social graph between Rando users
- Event scheduling
- Calendar integration
- Family sharing of contact lists
- Business contacts / CRM features
