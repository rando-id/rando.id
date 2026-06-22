#!/usr/bin/env tsx
// Render the generated OpenAPI spec to a file — no dev server needed.
//
// Used by:
//   - `pnpm spec:lint:static` (Spectral lint of the committed contract)
//   - Future: CI workflows that need the spec as a build artifact
//
// The work is done by buildSpec() in apps/api/app/v1/openapi.json/spec.ts.
// This script is the thin wrapper that picks an output path and writes.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// The import path uses a relative file ref so the tsx loader resolves
// straight to source. The function itself doesn't touch Next runtime.
import { buildSpec } from '../apps/api/app/v1/openapi.json/spec'

const outPath = resolve(process.argv[2] ?? 'apps/api/.openapi-rendered.json')

const spec = buildSpec()
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8')
console.log(`✓ wrote ${outPath}`)
