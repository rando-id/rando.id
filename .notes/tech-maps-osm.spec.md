---
status: approved # draft → proposed (issue filed) → approved (milestone attached)
issue: 272
---

# Maps + geocoding — OpenStreetMap

## Decision

- **Map rendering:** MapLibre GL JS (web) / equivalent on native via Leaflet-style libs. Tiles from OpenStreetMap.
- **Geocoding:** Nominatim (OSM's public geocoder) via the `@rando/maps` adapter in `packages/maps`.

Adapter shape so we can swap to Mapbox / Google / etc. without rewriting consumers.

## Why

- **No vendor key needed for OSM tile rendering.** Free, attribution-only.
- **Adapter pattern means switching is one file.** `packages/maps/src/adapter.ts` defines the interface; today's `osm.ts` is the only impl. Mapbox / Apple Maps / Google → new file, register in factory.
- **MapLibre is the OSS fork of Mapbox GL JS.** Maintained, modern, supports vector tiles, fast.
- **Nominatim is decent for low-traffic geocoding.** Free, no auth — works for our scale.

## Options considered

- **Mapbox** — beautiful default style, costs money once we exceed free MAUs. Will probably switch later when we want premium styling.
- **Google Maps** — best data quality, costs money + heavy SDKs, attribution requirements.
- **Apple Maps** (MapKit JS) — iOS-flavored, less complete coverage, gated to Apple-ecosystem usage.
- **Mapbox Geocoding API** — better quality than Nominatim, costs money per request.
- **AWS Location Service** — competitive, more complex API.

## What we accept

- **Nominatim has aggressive rate limits.** Free public endpoint is for low-traffic / dev use; production should be a self-hosted Nominatim or a paid alternative. Documented at the top of `packages/maps/src/osm.ts`.
- **OSM tile data quality varies by region.** Excellent in well-mapped areas, sparse elsewhere. For US-targeted MVP, fine.
- **No turn-by-turn navigation.** OSM has routing engines (OSRM, GraphHopper) but we don't need navigation yet.

## What would make us reconsider

- Hit Nominatim's rate limits (or get banned for exceeding them) → run our own Nominatim or pay for Mapbox.
- Premium-styled maps become a product differentiator we care about → Mapbox.
- A region we care about has sparse OSM coverage → at least check before launching there.
