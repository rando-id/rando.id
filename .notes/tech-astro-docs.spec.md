---
status: draft
issue: TBD
---

# Astro docs site(s) — contributor + product + API reference

## Why

Today the repo's documentation lives in three places, none of them
browsable:

- `.notes/*.spec.md` — design / decision corpus (~35 files)
- `.github/CONTRIBUTING.md` + `MAINTAINING.md` — operational docs
  (38K + 18K, dense markdown)
- `apps/api/openapi.json` (auto-generated) — API contract, no
  rendered surface

Contributors scrolling through markdown in GitHub is fine until
the corpus grows; at 35+ specs it's already slow. End users have no
help-center surface today. Astro is the right tool because it's
fast, MDX-supports, and ships static HTML to anywhere.

## Decision

**Three Astro sites, one config pattern, shared theme.** Each site
deploys to its own subdomain off `rando.id` (or `/path` if we'd
rather one origin — see "Hosting" below):

| Site              | Audience                                      | Content                                                               | URL candidate                              |
| ----------------- | --------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| **dev docs**      | Contributors                                  | `.notes/`, CONTRIBUTING, MAINTAINING, architecture diagrams           | `dev.rando.id` or `docs.rando.id/dev`      |
| **product docs**  | End users                                     | Onboarding, FAQ, troubleshooting, privacy / terms                     | `docs.rando.id` or `docs.rando.id/*`       |
| **API reference** | API integrators (future external + ourselves) | OpenAPI-rendered (via Scalar / Stoplight / Rapidoc), example requests | `api.rando.id/docs` or `docs.rando.id/api` |

Each site is a separate `apps/docs-*/` workspace OR a single
`apps/docs/` with content collections per site — TBD in Touch
Points below.

## Hosting

Two viable shapes:

| Option                                                                         | Pros                                                                                                       | Cons                                                                              |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **GitHub Pages × 3** (one repo subdir per site)                                | Free, easy CI deploys via `actions/upload-pages-artifact`                                                  | Three separate domains to wire DNS for; each domain needs its own GH Pages config |
| **Vercel × 3** (separate projects under `rando.id`'s team)                     | Fits the rest of our deploy strategy; previews work; auto-deploys via existing `rando deploy promote` flow | Counts toward Vercel project quota                                                |
| **Single Vercel project, content collections per site at `/{dev,docs,api}/*`** | One project, one domain; sub-paths cleanly map to audiences                                                | Mixes audiences on one origin; rewrites get hairy                                 |

**Recommend Vercel × 3** — fits the existing deploy strategy + each
site has independent deploy cadence. DNS already wired for
`*.rando.id` subdomains via Cloudflare; new CNAMEs are cheap.

## Content sources

| Site          | Source                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| dev docs      | `.notes/**/*.md` + `.github/CONTRIBUTING.md` + `.github/MAINTAINING.md` — symlinked or copied at build time |
| product docs  | `apps/docs-product/src/content/**/*.mdx` — authored fresh                                                   |
| API reference | `apps/api/openapi.json` — read at build, rendered via `@scalar/api-reference-astro` (or similar)            |

## Why Astro over alternatives

| Tool                       | Verdict                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| **Astro** (chosen)         | Static-first, MDX, content collections, fast build, framework-agnostic islands |
| Next.js docs (e.g. nextra) | Heavier; we'd add another Next deployment to manage                            |
| Docusaurus                 | React-only; uses Webpack — slower builds than Astro                            |
| Mintlify                   | Hosted SaaS; vendor lock + cost                                                |
| GitBook                    | Pretty but proprietary file format; can't ingest `.notes/` directly            |

## Touch points

1. `apps/docs-dev/` (new) — contributor docs site.
2. `apps/docs-product/` (new) — end-user docs site.
3. `apps/docs-api/` (new) — API reference site.
4. `pnpm-workspace.yaml` — already covers `apps/*`, no change.
5. **Shared theme**: `packages/docs-theme/` (new) — Astro layout
   components + Tamagui-aligned styling so all three sites look like
   Rando. Probably a thin layer pulling shared tokens from
   `@rando/brand`.
6. `rando.config.json` — add `docs` block listing the three sites
   (so `rando infra setup` provisions their Vercel projects).
7. `.github/workflows/deploy-preview.yml` — extends per-app gating
   to include docs apps.
8. DNS: 3 new CNAMEs in Cloudflare (`dev`, `docs`, `api`) pointing
   at Vercel. `rando infra setup` handles this if config'd correctly.

## What we accept

- **Three sites × Vercel quota.** Adds 3 to the quota count.
  Mitigated by the catalog work (Vercel native off; only our
  workflow deploys) and per-app gating (no docs deploys for
  unrelated PRs).
- **Content duplication risk** — same fact in `.notes/` and in
  product docs. Mitigation: dev docs lift directly from
  `.notes/`; product docs are fresh, no duplication of
  contributor content.
- **`apps/docs-*` boilerplate.** Three workspaces with similar
  shapes. Shared theme package keeps the common parts DRY;
  per-site only owns content + nav.

## What would make us reconsider

- **Maintenance burden of 3 sites** outweighs benefit. If product
  docs stay near-empty for 6 months, fold into the dev site under
  `/product` and drop one workspace.
- **OpenAPI tooling lands a hosted free tier we like** (e.g.
  Scalar's hosted plan with the right limits). At that point the
  api-docs Astro app becomes redundant.

## Refs

- `tech-api-rest-openapi.spec.md` — spec the api-docs site consumes
- `tech-tamagui.spec.md` — shared design tokens via `@rando/brand`
- `brand-brief.md` — visual identity that the docs theme inherits
