// `rando api` — bridges the API surface (apps/api) to external tooling
// without requiring a UI deploy round-trip.
//
// Today: `rando api postman sync` pushes the auto-generated OpenAPI
// spec at /v1/openapi.json into a Postman workspace as a collection.
// Future siblings (`rando api openapi dump`, `rando api postman run`,
// etc.) hang off the same command group.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command } from 'commander'
import type { Adapters } from '../config'
import { emit, type Io } from '../output'
import { loadSetupConfig } from '../setup-config'

const DEFAULT_CONFIG_PATH = 'rando.config.json'
const DEFAULT_COLLECTION_NAME = 'Rando API'
const DEFAULT_SPEC_URL = 'http://localhost:4000/v1/openapi.json'

export function apiCommand(adapters: Adapters, io: Io): Command {
  const api = new Command('api').description('API surface tooling (Postman, OpenAPI dump, etc.)')

  const postman = new Command('postman').description('Postman workspace integration')

  postman
    .command('sync')
    .description(
      'Push /v1/openapi.json into a Postman workspace as a collection. Idempotent: a previous collection with the same name is deleted first.',
    )
    .option(
      '--spec <urlOrPath>',
      `OpenAPI spec source — http(s) URL or filesystem path. Defaults to ${DEFAULT_SPEC_URL}.`,
      DEFAULT_SPEC_URL,
    )
    .option(
      '--workspace <id>',
      'Postman workspace id (overrides postman.workspaceId in rando.config.json)',
    )
    .option(
      '--name <name>',
      `Collection name shown in Postman (defaults to "${DEFAULT_COLLECTION_NAME}")`,
      DEFAULT_COLLECTION_NAME,
    )
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (opts: {
        spec: string
        workspace?: string
        name: string
        config: string
        json: boolean
      }) => {
        const { colors } = io
        const provider = adapters.postman()

        // Resolve workspace id: --workspace > config postman.workspaceId.
        let workspaceId = opts.workspace
        if (!workspaceId) {
          try {
            const cfg = loadSetupConfig(resolve(process.cwd(), opts.config))
            workspaceId = cfg.postman?.workspaceId
          } catch {
            // Config load is best-effort; the explicit-flag path still works.
          }
        }
        if (!workspaceId) {
          throw new Error(
            'No Postman workspace — pass --workspace, or set postman.workspaceId in rando.config.json (run `rando init` to set up).',
          )
        }

        // Resolve spec: http(s) URL → fetch; otherwise filesystem path.
        const sp = io.spinner(`Fetching OpenAPI spec from ${colors.resource(opts.spec)}…`)
        let spec: unknown
        try {
          spec = await loadSpec(opts.spec)
          sp.succeed(`Spec loaded from ${colors.resource(opts.spec)}`)
        } catch (e) {
          sp.fail(`Couldn't load spec from ${opts.spec}`)
          throw e
        }

        // Find + delete any previous collection with the same name so
        // the sync stays a clean replace (Postman has no in-place
        // OpenAPI-update endpoint we can rely on).
        const existing = await provider.findCollectionByName({
          workspaceId,
          name: opts.name,
        })
        if (existing) {
          io.stdout(
            `${colors.hint(`removing previous collection ${existing.id} (${existing.name})`)}`,
          )
          await provider.deleteCollection(existing.id)
        }

        const importSp = io.spinner(`Importing into workspace ${colors.resource(workspaceId)}…`)
        let created
        try {
          created = await provider.importOpenApi({ workspaceId, spec })
          importSp.succeed(`Imported as ${colors.resource(created.name)}`)
        } catch (e) {
          importSp.fail('Import failed')
          throw e
        }

        const url = collectionUrl(created.uid, workspaceId)
        emit(
          io,
          opts.json,
          { ok: true, replaced: existing != null, collection: created, url },
          () =>
            `${colors.success('✓')} ${existing ? 'replaced' : 'created'} ${colors.resource(created.name)}\n` +
            `  ${colors.hint('uid:')}  ${created.uid}\n` +
            `  ${colors.hint('open:')} ${url}`,
        )
      },
    )

  api.addCommand(postman)
  return api
}

/**
 * Load an OpenAPI spec from either an http(s) URL (we fetch it) or a
 * filesystem path (we read + JSON.parse). The URL path is the
 * dev-loop default — `rando dev` exposes /v1/openapi.json locally.
 */
async function loadSpec(source: string): Promise<unknown> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) {
      throw new Error(`fetch ${source} → ${res.status} ${res.statusText}`)
    }
    return await res.json()
  }
  const raw = readFileSync(resolve(process.cwd(), source), 'utf-8')
  return JSON.parse(raw)
}

/**
 * Build the Postman UI URL for a collection. Includes the workspace
 * id so the link drops the viewer into the right context.
 */
function collectionUrl(collectionUid: string, workspaceId: string): string {
  return `https://web.postman.co/workspace/${workspaceId}/collection/${collectionUid}`
}
