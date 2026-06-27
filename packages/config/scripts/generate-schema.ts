#!/usr/bin/env tsx
// Generate `rando.config.schema.json` at the repo root from the Zod schema.
// Run: `pnpm --filter @rando/config generate:schema`.
//
// The output file is committed so editors can use it via `$schema:` without
// a build step. Re-generate whenever `rando-config.ts` changes.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { SetupConfigSchema } from '../src/rando-config'

const schema = zodToJsonSchema(SetupConfigSchema, {
  name: 'RandoConfig',
  $refStrategy: 'root',
})

const outPath = resolve(import.meta.dirname, '../../../rando.config.schema.json')
writeFileSync(outPath, JSON.stringify(schema, null, 2) + '\n', 'utf-8')
console.log(`Wrote ${outPath}`)
