// `rando api` — bridges the API surface (apps/api) to external tooling
// without requiring a UI deploy round-trip.
//
// Today: `rando api postman sync` pushes the auto-generated OpenAPI
// spec at /v1/openapi.json into a Postman workspace as a collection.
// Future siblings (`rando api openapi dump`, `rando api postman run`,
// etc.) hang off the same command group.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Command } from 'commander'
import { convertV2 } from 'openapi-to-postmanv2'
import type { Adapters } from '../config'
import { PostmanPlanLimitError } from '../domain/errors'
import { emit, type Io } from '../output'
import { loadSetupConfig } from '../setup-config'

const DEFAULT_CONFIG_PATH = 'rando.config.json'
const DEFAULT_COLLECTION_NAME = 'Rando API'
const DEFAULT_API_VERSION = 'v1'
const DEFAULT_SPEC_TYPE = 'OPENAPI:3.0'
const DEFAULT_SPEC_FILE_PATH = 'index.json'
const DEFAULT_SPEC_URL = 'http://localhost:4000/v1/openapi.json'
const DEFAULT_COLLECTION_OUTPUT = 'postman/rando-api.postman_collection.json'
const DEFAULT_ENV_DIR = 'postman/environments'

type PushTarget = 'spec' | 'api'

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
      'Postman workspace id (overrides testing.api.workspaceId in rando.config.json)',
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
        // Two adapters:
        //   - apiTesting() dispatches on testing.api.kind for the
        //     vendor-neutral collection push.
        //   - postman() for the Spec Hub mirror, which is Postman-only.
        // Both factories check kind so a misconfigured project errors
        // before any I/O.
        const apiTesting = adapters.apiTesting({ configPath: opts.config })
        const postman = adapters.postman({ configPath: opts.config })

        // Resolve workspace id: --workspace > config testing.api.workspaceId.
        let workspaceId = opts.workspace
        if (!workspaceId) {
          try {
            const cfg = loadSetupConfig(resolve(process.cwd(), opts.config))
            workspaceId = cfg.testing?.api?.workspaceId
          } catch {
            // Config load is best-effort; the explicit-flag path still works.
          }
        }
        if (!workspaceId) {
          throw new Error(
            'No Postman workspace — pass --workspace, or set testing.api.workspaceId in rando.config.json (run `rando init` to set up).',
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

        // Sync the collection through the vendor-neutral high-level
        // surface. The adapter owns find→delete→import orchestration.
        const syncSp = io.spinner(`Syncing collection to ${colors.resource(workspaceId)}…`)
        let synced
        try {
          synced = await apiTesting.syncCollectionFromSpec({
            target: workspaceId,
            name: opts.name,
            spec,
          })
          syncSp.succeed(
            `${synced.replaced ? 'Replaced' : 'Created'} ${colors.resource(synced.name)}`,
          )
        } catch (e) {
          syncSp.fail('Sync failed')
          throw e
        }

        // Mirror the spec into Postman's Spec Hub alongside the
        // collection. Spec Hub works on the Free tier (API Builder
        // doesn't — that's a paid feature), so this is the default.
        // Soft-skip per the orchestrator rule if Spec Hub itself errors,
        // since the collection push has already succeeded.
        let spec_: { id: string; name: string } | null = null
        let specCreated = false
        let specSkipReason: string | null = null
        try {
          const result = await pushSpecHub(postman, io, {
            workspaceId,
            name: opts.name,
            fileContent: typeof spec === 'string' ? spec : JSON.stringify(spec),
          })
          spec_ = { id: result.spec.id, name: result.spec.name }
          specCreated = result.specCreated
        } catch (e) {
          specSkipReason = e instanceof Error ? e.message : String(e)
        }

        emit(
          io,
          opts.json,
          {
            ok: true,
            replaced: synced.replaced,
            collection: { uid: synced.ref, name: synced.name },
            spec: spec_,
            specSkipped: specSkipReason !== null,
            ...(specSkipReason !== null ? { specSkipReason } : {}),
            url: synced.url,
          },
          () => {
            const lines = [
              `${colors.success('✓')} ${synced.replaced ? 'replaced' : 'created'} ${colors.resource(synced.name)}`,
              `  ${colors.hint('uid:')}  ${synced.ref}`,
            ]
            if (synced.url) lines.push(`  ${colors.hint('open:')} ${synced.url}`)
            if (spec_) {
              lines.push(
                `${colors.success('✓')} ${specCreated ? 'created' : 'updated'} Spec Hub spec ${colors.resource(spec_.name)} (id ${spec_.id})`,
              )
            } else if (specSkipReason) {
              // Human-readable note only — JSON consumers see it via
              // `specSkipReason` in the structured payload instead, so
              // stdout doesn't get a `note:` line mixed in with the
              // JSON body (would break JSON.parse).
              lines.push(`  ${colors.warn('note:')} Spec Hub push skipped — ${specSkipReason}`)
            }
            return lines.join('\n')
          },
        )
      },
    )

  postman
    .command('push-spec')
    .description(
      'Push the OpenAPI spec into a Postman workspace. Default target is Spec Hub (works on the Free tier). Use --target api to push to the API Builder entity instead (paid-tier feature, returns a plan-upgrade error on Free). Idempotent: a matching named entity is updated in place; otherwise a new one is created.',
    )
    .option(
      '--target <kind>',
      `Postman surface — "spec" (Spec Hub, default) or "api" (API Builder, paid).`,
      'spec',
    )
    .option(
      '--spec <urlOrPath>',
      `OpenAPI spec source — http(s) URL or filesystem path. Defaults to ${DEFAULT_SPEC_URL}.`,
      DEFAULT_SPEC_URL,
    )
    .option(
      '--workspace <id>',
      'Postman workspace id (overrides testing.api.workspaceId in rando.config.json)',
    )
    .option(
      '--name <name>',
      `Entity name shown in Postman (defaults to "${DEFAULT_COLLECTION_NAME}")`,
      DEFAULT_COLLECTION_NAME,
    )
    .option(
      '--api-version <name>',
      `API version label (only used with --target api). Defaults to "${DEFAULT_API_VERSION}".`,
      DEFAULT_API_VERSION,
    )
    .option(
      '--spec-type <type>',
      `Spec Hub type (only used with --target spec). Defaults to "${DEFAULT_SPEC_TYPE}".`,
      DEFAULT_SPEC_TYPE,
    )
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (opts: {
        target: string
        spec: string
        workspace?: string
        name: string
        apiVersion: string
        specType: string
        config: string
        json: boolean
      }) => {
        const { colors } = io
        const provider = adapters.postman({ configPath: opts.config })
        const target = opts.target as PushTarget
        if (target !== 'spec' && target !== 'api') {
          throw new Error(`Unknown --target "${opts.target}" — must be "spec" or "api".`)
        }
        const workspaceId = resolveWorkspaceId(opts.workspace, opts.config)

        const sp = io.spinner(`Fetching OpenAPI spec from ${colors.resource(opts.spec)}…`)
        let spec: unknown
        try {
          spec = await loadSpec(opts.spec)
          sp.succeed(`Spec loaded from ${colors.resource(opts.spec)}`)
        } catch (e) {
          sp.fail(`Couldn't load spec from ${opts.spec}`)
          throw e
        }

        if (target === 'spec') {
          const { spec: pushed, specCreated } = await pushSpecHub(provider, io, {
            workspaceId,
            name: opts.name,
            type: opts.specType,
            fileContent: typeof spec === 'string' ? spec : JSON.stringify(spec),
          })
          emit(
            io,
            opts.json,
            { ok: true, created: specCreated, spec: pushed },
            () =>
              `${colors.success('✓')} ${specCreated ? 'created' : 'updated'} Spec Hub spec ${colors.resource(pushed.name)}\n` +
              `  ${colors.hint('id:')}   ${pushed.id}\n` +
              `  ${colors.hint('type:')} ${pushed.type}`,
          )
          return
        }

        // target === 'api'
        let api, apiCreated
        try {
          ;({ api, apiCreated } = await pushApiEntity(provider, io, {
            workspaceId,
            name: opts.name,
            version: opts.apiVersion,
            spec,
          }))
        } catch (e) {
          if (e instanceof PostmanPlanLimitError) {
            throw new Error(
              `Postman plan blocks API entities (${e.limit}). Upgrade to a Postman plan that includes APIs, or run \`rando api postman push-spec\` without --target api to use Spec Hub instead (works on Free).`,
            )
          }
          throw e
        }
        emit(
          io,
          opts.json,
          { ok: true, created: apiCreated, api, version: opts.apiVersion },
          () =>
            `${colors.success('✓')} ${apiCreated ? 'created' : 'updated'} API entity ${colors.resource(api.name)}\n` +
            `  ${colors.hint('id:')}      ${api.id}\n` +
            `  ${colors.hint('version:')} ${opts.apiVersion}`,
        )
      },
    )

  postman
    .command('generate')
    .description(
      'Generate a Postman v2.1 collection JSON file from the OpenAPI spec. Pure conversion — no Postman API call. Use the file with `postman collection run` or commit it to the repo for collection-as-code testing.',
    )
    .option(
      '--spec <urlOrPath>',
      `OpenAPI spec source — http(s) URL or filesystem path. Defaults to ${DEFAULT_SPEC_URL}.`,
      DEFAULT_SPEC_URL,
    )
    .option(
      '--out <path>',
      `Output file path (Postman v2.1 collection JSON). Defaults to ${DEFAULT_COLLECTION_OUTPUT}.`,
      DEFAULT_COLLECTION_OUTPUT,
    )
    .option('--name <name>', `Collection name override (otherwise the spec's info.title is used)`)
    .option(
      '-f, --force',
      'Overwrite the output file when it already exists. Safety guard: collection-as-code means the file likely has hand-authored pm.test() blocks that a blind regenerate would wipe.',
      false,
    )
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (opts: { spec: string; out: string; name?: string; force: boolean; json: boolean }) => {
        const { colors } = io
        const outPath = resolve(process.cwd(), opts.out)
        if (existsSync(outPath) && !opts.force) {
          throw new Error(
            `${opts.out} already exists — re-running would overwrite any pm.test() blocks you've added. ` +
              `Pass --force to overwrite, or --out <other-path> to write somewhere else.`,
          )
        }
        const sp = io.spinner(`Loading OpenAPI spec from ${colors.resource(opts.spec)}…`)
        let spec: unknown
        try {
          spec = await loadSpec(opts.spec)
          sp.succeed(`Spec loaded from ${colors.resource(opts.spec)}`)
        } catch (e) {
          sp.fail(`Couldn't load spec from ${opts.spec}`)
          throw e
        }

        const collection = await openApiToCollection(spec, opts.name)
        mkdirSync(dirname(outPath), { recursive: true })
        writeFileSync(outPath, JSON.stringify(collection, null, 2) + '\n', 'utf-8')

        emit(
          io,
          opts.json,
          { ok: true, out: opts.out, name: collection.info?.name },
          () =>
            `${colors.success('✓')} wrote collection ${colors.resource(collection.info?.name ?? '<unnamed>')}\n` +
            `  ${colors.hint('file:')} ${opts.out}\n` +
            `  ${colors.hint('next:')} review the file, hand-author pm.test() assertions, then \`pnpm test:api\``,
        )
      },
    )

  postman
    .command('push')
    .description(
      'Push the local collection JSON (with hand-authored pm.test() blocks intact) and environment JSONs into a Postman workspace. Uses PUT when the named entity already exists so uids stay stable across pushes — different from `sync`, which converts from OpenAPI and rotates the uid.',
    )
    .option(
      '--collection <path>',
      `Local collection JSON to push. Defaults to ${DEFAULT_COLLECTION_OUTPUT}.`,
      DEFAULT_COLLECTION_OUTPUT,
    )
    .option(
      '--env-dir <path>',
      `Directory of Postman environment JSON files to push. Defaults to ${DEFAULT_ENV_DIR}. Pass --no-envs to skip environments.`,
      DEFAULT_ENV_DIR,
    )
    .option('--no-envs', 'Skip pushing environments')
    .option(
      '--workspace <id>',
      'Postman workspace id (overrides testing.api.workspaceId in rando.config.json)',
    )
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (opts: {
        collection: string
        envDir: string
        envs: boolean
        workspace?: string
        config: string
        json: boolean
      }) => {
        const { colors } = io
        const provider = adapters.postman({ configPath: opts.config })
        const workspaceId = resolveWorkspaceId(opts.workspace, opts.config)

        // 1. Collection — load file, find by name, PUT or POST.
        const collectionPath = resolve(process.cwd(), opts.collection)
        if (!existsSync(collectionPath)) {
          throw new Error(
            `Collection file not found: ${opts.collection}. Run \`rando api postman generate\` first.`,
          )
        }
        const collection = JSON.parse(readFileSync(collectionPath, 'utf-8')) as {
          info?: { name?: string }
        }
        const collectionName = collection.info?.name ?? DEFAULT_COLLECTION_NAME
        const existing = await provider.findCollectionByName({
          workspaceId,
          name: collectionName,
        })
        const collSp = io.spinner(
          `Pushing collection ${colors.resource(collectionName)} → workspace ${colors.resource(workspaceId)}…`,
        )
        let pushedCollection
        try {
          pushedCollection = existing
            ? await provider.updateCollection({ uid: existing.uid, collection })
            : await provider.createCollection({ workspaceId, collection })
          collSp.succeed(
            `${existing ? 'Updated' : 'Created'} collection ${colors.resource(pushedCollection.name)} (uid ${pushedCollection.uid})`,
          )
        } catch (e) {
          collSp.fail('Collection push failed')
          throw e
        }

        // 2. Environments — same find-by-name-then-PUT-or-POST pattern.
        const pushedEnvs: Array<{ name: string; uid: string; updated: boolean }> = []
        if (opts.envs) {
          const envFiles = listEnvironmentFiles(opts.envDir)
          for (const file of envFiles) {
            const envJson = JSON.parse(readFileSync(file, 'utf-8')) as { name?: string }
            const envName = envJson.name
            if (!envName) {
              io.stdout(`  ${colors.warn('skip:')} ${file} has no \`name\` field`)
              continue
            }
            const existingEnv = await provider.findEnvironmentByName({
              workspaceId,
              name: envName,
            })
            const envSp = io.spinner(`Pushing environment ${colors.resource(envName)}…`)
            try {
              const pushed = existingEnv
                ? await provider.updateEnvironment({ uid: existingEnv.uid, environment: envJson })
                : await provider.createEnvironment({ workspaceId, environment: envJson })
              envSp.succeed(
                `${existingEnv ? 'Updated' : 'Created'} environment ${colors.resource(pushed.name)}`,
              )
              pushedEnvs.push({ name: pushed.name, uid: pushed.uid, updated: !!existingEnv })
            } catch (e) {
              envSp.fail(`Environment ${envName} push failed`)
              throw e
            }
          }
        }

        const collectionUrlStr = collectionUrl(pushedCollection.uid, workspaceId)
        emit(
          io,
          opts.json,
          {
            ok: true,
            workspaceId,
            collection: pushedCollection,
            environments: pushedEnvs,
            url: collectionUrlStr,
          },
          () =>
            `${colors.success('✓')} pushed ${colors.resource(pushedCollection.name)} + ${pushedEnvs.length} env(s)\n` +
            `  ${colors.hint('open:')} ${collectionUrlStr}`,
        )
      },
    )

  api.addCommand(postman)
  return api
}

/**
 * Push an OpenAPI spec into Postman's Spec Hub. Find spec by name
 * (idempotent across re-runs) → create if missing, otherwise PATCH the
 * root file's content. Used by both `sync` (as the spec-push half
 * after collection import) and `push-spec --target spec` (default).
 *
 * Spec Hub works on the Postman Free tier, so this is the load-bearing
 * path for unpaid users. The API Builder counterpart (`pushApiEntity`)
 * is only invoked when `--target api` is set.
 */
async function pushSpecHub(
  provider: ReturnType<Adapters['postman']>,
  io: Io,
  input: { workspaceId: string; name: string; type?: string; fileContent: string },
): Promise<{
  spec: { id: string; name: string; type: string }
  specCreated: boolean
}> {
  const { colors } = io
  const sp = io.spinner(`Pushing spec ${colors.resource(input.name)} → Spec Hub…`)
  try {
    const existing = await provider.findSpecByName({
      workspaceId: input.workspaceId,
      name: input.name,
    })
    if (existing) {
      await provider.upsertSpecFile({
        specId: existing.id,
        filePath: DEFAULT_SPEC_FILE_PATH,
        content: input.fileContent,
      })
      sp.succeed(`Updated Spec Hub spec ${colors.resource(existing.name)}`)
      return { spec: existing, specCreated: false }
    }
    const created = await provider.createSpec({
      workspaceId: input.workspaceId,
      name: input.name,
      type: input.type,
      filePath: DEFAULT_SPEC_FILE_PATH,
      fileContent: input.fileContent,
    })
    sp.succeed(`Created Spec Hub spec ${colors.resource(created.name)}`)
    return { spec: created, specCreated: true }
  } catch (e) {
    sp.fail('Spec Hub push failed')
    throw e
  }
}

/**
 * Push an OpenAPI spec into Postman's API Builder ("API" entity).
 * Find the API by name → create if missing → upsert the schema on the
 * named version. Paid-tier feature; the Free tier returns a
 * PostmanPlanLimitError that callers translate into "upgrade required".
 */
async function pushApiEntity(
  provider: ReturnType<Adapters['postman']>,
  io: Io,
  input: { workspaceId: string; name: string; version: string; spec: unknown },
): Promise<{ api: { id: string; name: string }; apiCreated: boolean }> {
  const { colors } = io
  const apiSp = io.spinner(`Pushing spec ${colors.resource(input.name)} → API entity…`)
  try {
    const existing = await provider.findApiByName({
      workspaceId: input.workspaceId,
      name: input.name,
    })
    const api = existing
      ? existing
      : await provider.createApi({ workspaceId: input.workspaceId, name: input.name })
    await provider.upsertApiSchema({
      apiId: api.id,
      version: input.version,
      spec: input.spec,
    })
    apiSp.succeed(
      `${existing ? 'Updated' : 'Created'} API entity ${colors.resource(api.name)} (${input.version})`,
    )
    return { api: { id: api.id, name: api.name }, apiCreated: !existing }
  } catch (e) {
    apiSp.fail('Spec push failed')
    throw e
  }
}

/**
 * Resolve a Postman workspace id from a CLI flag, falling back to
 * rando.config.json's `testing.api.workspaceId`. Throws when neither
 * is set — every command in this group needs a workspace.
 */
function resolveWorkspaceId(flag: string | undefined, configPath: string): string {
  if (flag) return flag
  try {
    const cfg = loadSetupConfig(resolve(process.cwd(), configPath))
    const id = cfg.testing?.api?.workspaceId
    if (id) return id
  } catch {
    // Config load is best-effort; the explicit-flag path still works.
  }
  throw new Error(
    'No Postman workspace — pass --workspace, or set testing.api.workspaceId in rando.config.json (run `rando init` to set up).',
  )
}

/**
 * List Postman environment JSON files in a directory. Returns absolute
 * paths. Only files matching `*.postman_environment.json` are picked
 * up so non-environment files (READMEs, secrets) in the same directory
 * don't get accidentally pushed.
 */
function listEnvironmentFiles(dir: string): string[] {
  const abs = resolve(process.cwd(), dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((f) => f.endsWith('.postman_environment.json'))
    .map((f) => join(abs, f))
    .sort()
}

/**
 * Convert an OpenAPI spec object into a Postman v2.1 collection via
 * openapi-to-postmanv2. The library is callback-based and we want a
 * promise — wrap it. `convertV2` is the v2.1 collection format, which
 * is what postman-cli + the Postman UI both expect today.
 *
 * `name` overrides the collection name (info.name in the output JSON)
 * when supplied; otherwise the converter inherits info.title from the
 * spec.
 */
async function openApiToCollection(
  spec: unknown,
  name?: string,
): Promise<{ info?: { name?: string }; item?: unknown[] }> {
  const data = typeof spec === 'string' ? spec : JSON.stringify(spec)
  // openapi-to-postmanv2 uses Math.random() internally to pick a value
  // from enum sets when synthesizing request/response examples. Pin it
  // to 0 for the duration of the convert call so the committed
  // collection file diffs cleanly across regenerations — the same spec
  // always produces byte-identical output. Restored in the finally.
  const originalRandom = Math.random
  Math.random = () => 0
  const collection = await new Promise<{ info?: { name?: string }; item?: unknown[] }>(
    (resolvePromise, reject) => {
      convertV2(
        { type: 'string', data },
        {
          folderStrategy: 'Tags',
          // Off: don't synthesize random values for unconstrained
          // fields; render `<string>`, `<number>`, etc. as placeholders.
          schemaFaker: false,
        },
        (err, result) => {
          if (err) {
            reject(new Error(err.message))
            return
          }
          if (!result?.result) {
            reject(new Error(result?.reason ?? 'openapi-to-postmanv2 failed without a reason'))
            return
          }
          const output = result.output?.[0]?.data
          if (!output) {
            reject(new Error('openapi-to-postmanv2 returned no output'))
            return
          }
          resolvePromise(output as { info?: { name?: string }; item?: unknown[] })
        },
      )
    },
  ).finally(() => {
    Math.random = originalRandom
  })
  if (name && collection.info) {
    collection.info.name = name
  }
  return normalizeForDiff(collection)
}

/**
 * Make the generated collection diff-friendly so re-running the
 * generator against an unchanged spec produces byte-identical output.
 *
 * openapi-to-postmanv2 stamps two kinds of noise:
 *   1. Random UUIDs on the collection root + every nested item /
 *      response — Postman regenerates these on import, so we drop them.
 *   2. Random enum-value picks inside example response bodies — these
 *      are display-only (postman-cli never reads `response[].body`), so we
 *      drop response examples entirely. Request bodies are kept;
 *      their enum noise comes through on actual regeneration runs
 *      where the spec has changed, which is when we expect a diff.
 *
 * Walks the object recursively. Removes any key named `_postman_id`,
 * `id`, or `response` (when the value is an array — that's the
 * Postman example-response array).
 */
function normalizeForDiff<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeForDiff(v)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === '_postman_id' || k === 'id') continue
      if (k === 'response' && Array.isArray(v)) continue
      out[k] = normalizeForDiff(v)
    }
    return out as T
  }
  return value
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
