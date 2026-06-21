import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../cli'
import type { ClerkProvider } from '../domain/clerk'
import type { Adapters } from '../config'
import { PostmanPlanLimitError } from '../domain/errors'
import type { DbProvider } from '../domain/db'
import type { DeployProvider } from '../domain/deploy'
import type { DnsProvider } from '../domain/dns'
import type { GhProvider } from '../domain/gh'
import type { PostmanProvider } from '../domain/postman'
import type { SecretsProvider } from '../domain/secrets'
import type { IssueTrackerProvider } from '../domain/tracker'
import type { TunnelProvider } from '../domain/tunnel'
import { captureIo } from './helpers'

// Build a fake Adapters object with only the providers a given test needs.
function mockAdapters(
  overrides: Partial<{
    db: DbProvider
    tunnel: TunnelProvider
    dns: DnsProvider
    deploy: DeployProvider
    tracker: IssueTrackerProvider
    postman: PostmanProvider
    secrets: SecretsProvider
    gh: GhProvider
  }>,
): Adapters {
  return {
    db: () => overrides.db ?? notConfigured('db'),
    tunnel: () => overrides.tunnel ?? notConfigured('tunnel'),
    dns: () => overrides.dns ?? notConfigured('dns'),
    deploy: () => overrides.deploy ?? notConfigured('deploy'),
    tracker: () => overrides.tracker ?? notConfigured('tracker'),
    postman: () => overrides.postman ?? notConfigured('postman'),
    secrets: () => overrides.secrets ?? notConfigured('secrets'),
    gh: () => overrides.gh ?? notConfigured('gh'),
    vercelCli: () => notConfigured('vercelCli'),
  }
}

function notConfigured(name: string): never {
  throw new Error(`${name} adapter not provided in this test`)
}

const noExit = () => {
  // commander uses exitOverride so process.exit shouldn't fire on success
  throw new Error('unexpected process.exit')
}

describe('db commands', () => {
  it('db project create calls the provider and prints a summary', async () => {
    const db: Partial<DbProvider> = {
      createProject: vi.fn(async ({ name }) => ({ id: 'p1', name })),
    }
    const io = captureIo()
    await run(['db', 'project', 'create', 'rando'], {
      adapters: mockAdapters({ db: db as DbProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(db.createProject).toHaveBeenCalledWith({ name: 'rando', region: undefined })
    expect(io.stdout.join('\n')).toContain('created project: rando')
  })

  it('--json emits raw JSON instead of summary', async () => {
    const db: Partial<DbProvider> = {
      createProject: vi.fn(async ({ name }) => ({ id: 'p1', name })),
    }
    const io = captureIo()
    await run(['db', 'project', 'create', 'rando', '--json'], {
      adapters: mockAdapters({ db: db as DbProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(JSON.parse(io.stdout.join(''))).toEqual({ id: 'p1', name: 'rando' })
  })

  it('db connection-string passes --pooled through', async () => {
    const db: Partial<DbProvider> = {
      getConnectionString: vi.fn(async () => ({
        branch: 'br',
        pooled: true,
        url: 'postgres://example',
      })),
    }
    const io = captureIo()
    await run(['db', 'connection-string', 'proj', 'br', '--pooled'], {
      adapters: mockAdapters({ db: db as DbProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(db.getConnectionString).toHaveBeenCalledWith({
      projectId: 'proj',
      branchId: 'br',
      pooled: true,
    })
    expect(io.stdout.join('\n')).toBe('postgres://example')
  })
})

describe('tunnel commands', () => {
  it('tunnel route add resolves the tunnel by name first', async () => {
    const tunnel: Partial<TunnelProvider> = {
      getTunnelByName: vi.fn(async ({ name }) =>
        name === 'rando-dev' ? { id: 't1', name } : null,
      ),
      addRoute: vi.fn(async ({ hostname, service }) => ({
        id: hostname,
        hostname,
        service,
      })),
    }
    const io = captureIo()
    await run(
      [
        'tunnel',
        'route',
        'add',
        'rando-dev',
        'dev-api.rando-id.dev',
        'http://host.docker.internal:4000',
      ],
      {
        adapters: mockAdapters({ tunnel: tunnel as TunnelProvider }),
        io: io.io,
        exit: noExit,
      },
    )
    expect(tunnel.addRoute).toHaveBeenCalledWith({
      tunnelId: 't1',
      hostname: 'dev-api.rando-id.dev',
      service: 'http://host.docker.internal:4000',
    })
    expect(io.stdout.join('\n')).toContain('added route: dev-api.rando-id.dev')
  })

  it('tunnel token errors with exit code 3 when tunnel does not exist', async () => {
    const tunnel: Partial<TunnelProvider> = {
      getTunnelByName: vi.fn(async () => null),
    }
    const io = captureIo()
    const exit = vi.fn() as unknown as (code: number) => never
    await run(['tunnel', 'token', 'missing'], {
      adapters: mockAdapters({ tunnel: tunnel as TunnelProvider }),
      io: io.io,
      exit,
    })
    expect(exit).toHaveBeenCalledWith(3)
    expect(io.stderr.join('\n')).toContain('tunnel not found: missing')
  })
})

describe('deploy commands', () => {
  it('deploy env set parses scopes correctly', async () => {
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async ({ name }) => ({ id: 'p1', name, rootDirectory: null })),
      setEnv: vi.fn(async ({ key, scopes }) => ({ id: 'e1', key, scopes })),
    }
    const io = captureIo()
    await run(
      [
        'deploy',
        'env',
        'set',
        'rando-api',
        'DATABASE_URL',
        'postgres://x',
        '--scope',
        'production,preview',
      ],
      {
        adapters: mockAdapters({ deploy: deploy as DeployProvider }),
        io: io.io,
        exit: noExit,
      },
    )
    expect(deploy.setEnv).toHaveBeenCalledWith({
      projectId: 'p1',
      key: 'DATABASE_URL',
      value: 'postgres://x',
      scopes: ['production', 'preview'],
    })
  })

  it('deploy env set rejects invalid scopes', async () => {
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async () => ({ id: 'p1', name: 'rando-api', rootDirectory: null })),
      setEnv: vi.fn(),
    }
    const io = captureIo()
    const exit = vi.fn() as unknown as (code: number) => never
    await run(['deploy', 'env', 'set', 'rando-api', 'K', 'V', '--scope', 'staging'], {
      adapters: mockAdapters({ deploy: deploy as DeployProvider }),
      io: io.io,
      exit,
    })
    expect(deploy.setEnv).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)
    expect(io.stderr.join('\n')).toMatch(/Invalid scope/)
  })

  it('deploy app create forwards --root and --repo', async () => {
    const deploy: Partial<DeployProvider> = {
      createProject: vi.fn(async ({ name, rootDirectory }) => ({
        id: 'p1',
        name,
        rootDirectory,
      })),
    }
    const io = captureIo()
    await run(
      ['deploy', 'app', 'create', 'rando-api', '--root', 'apps/api', '--repo', 'me/rando'],
      {
        adapters: mockAdapters({ deploy: deploy as DeployProvider }),
        io: io.io,
        exit: noExit,
      },
    )
    expect(deploy.createProject).toHaveBeenCalledWith({
      name: 'rando-api',
      rootDirectory: 'apps/api',
      repo: 'me/rando',
    })
  })
})

describe('dns commands', () => {
  it('dns record add normalizes type to uppercase', async () => {
    const dns: Partial<DnsProvider> = {
      addRecord: vi.fn(async (input) => ({
        id: 'r1',
        type: input.type,
        name: input.name,
        content: input.content,
        ttl: input.ttl ?? 1,
        proxied: input.proxied ?? false,
      })),
    }
    const io = captureIo()
    await run(
      ['dns', 'record', 'add', 'rando-id.dev', 'cname', 'staging-api', 'cname.vercel-dns.com'],
      {
        adapters: mockAdapters({ dns: dns as DnsProvider }),
        io: io.io,
        exit: noExit,
      },
    )
    expect(dns.addRecord).toHaveBeenCalledWith({
      zone: 'rando-id.dev',
      type: 'CNAME',
      name: 'staging-api',
      content: 'cname.vercel-dns.com',
      ttl: 1,
      proxied: false,
    })
  })

  it('dns record add rejects unknown types', async () => {
    const dns: Partial<DnsProvider> = { addRecord: vi.fn() }
    const io = captureIo()
    const exit = vi.fn() as unknown as (code: number) => never
    await run(['dns', 'record', 'add', 'rando-id.dev', 'NOPE', 'foo', 'bar'], {
      adapters: mockAdapters({ dns: dns as DnsProvider }),
      io: io.io,
      exit,
    })
    expect(dns.addRecord).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)
    expect(io.stderr.join('\n')).toMatch(/Invalid record type/)
  })
})

describe('destructive commands — confirm + --yes', () => {
  it('db project delete prompts, then deletes on yes', async () => {
    const db: Partial<DbProvider> = { deleteProject: vi.fn(async () => {}) }
    const io = captureIo() // confirm defaults to true
    await run(['db', 'project', 'delete', 'p1'], {
      adapters: mockAdapters({ db: db as DbProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(io.confirmCalls).toHaveLength(1)
    expect(io.confirmCalls[0]).toMatch(/Delete db project "p1"/)
    expect(db.deleteProject).toHaveBeenCalledWith({ projectId: 'p1' })
  })

  it('db project delete --yes skips the prompt', async () => {
    const db: Partial<DbProvider> = { deleteProject: vi.fn(async () => {}) }
    const io = captureIo()
    await run(['db', 'project', 'delete', 'p1', '--yes'], {
      adapters: mockAdapters({ db: db as DbProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(io.confirmCalls).toHaveLength(0)
    expect(db.deleteProject).toHaveBeenCalledWith({ projectId: 'p1' })
  })

  it('db project create emits an escape-hatch warning and prompts', async () => {
    const db: Partial<DbProvider> = {
      createProject: vi.fn(async ({ name }) => ({ id: 'p1', name })),
    }
    const io = captureIo() // confirm defaults to true
    await run(['db', 'project', 'create', 'standalone'], {
      adapters: mockAdapters({ db: db as DbProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(io.stderr.join('\n')).toMatch(/escape-hatch.*infra setup/i)
    expect(io.confirmCalls).toHaveLength(1)
    expect(db.createProject).toHaveBeenCalled()
  })

  it('db project create --yes skips the prompt but still warns', async () => {
    const db: Partial<DbProvider> = {
      createProject: vi.fn(async ({ name }) => ({ id: 'p1', name })),
    }
    const io = captureIo()
    await run(['db', 'project', 'create', 'standalone', '--yes'], {
      adapters: mockAdapters({ db: db as DbProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(io.stderr.join('\n')).toMatch(/escape-hatch/i)
    expect(io.confirmCalls).toHaveLength(0)
    expect(db.createProject).toHaveBeenCalled()
  })

  it('db project create aborts when user declines', async () => {
    const db: Partial<DbProvider> = { createProject: vi.fn() }
    const io = captureIo({ confirm: false })
    await run(['db', 'project', 'create', 'standalone'], {
      adapters: mockAdapters({ db: db as DbProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(db.createProject).not.toHaveBeenCalled()
    expect(io.stdout.join('\n')).toContain('aborted.')
  })

  it('db project delete aborts when user declines', async () => {
    const db: Partial<DbProvider> = { deleteProject: vi.fn(async () => {}) }
    const io = captureIo({ confirm: false })
    await run(['db', 'project', 'delete', 'p1'], {
      adapters: mockAdapters({ db: db as DbProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(db.deleteProject).not.toHaveBeenCalled()
    expect(io.stdout.join('\n')).toContain('aborted.')
  })

  it('db branch delete passes projectId + branchId', async () => {
    const db: Partial<DbProvider> = { deleteBranch: vi.fn(async () => {}) }
    const io = captureIo()
    await run(['db', 'branch', 'delete', 'p1', 'br_x', '-y'], {
      adapters: mockAdapters({ db: db as DbProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(db.deleteBranch).toHaveBeenCalledWith({ projectId: 'p1', branchId: 'br_x' })
  })

  it('tunnel delete resolves by name then calls deleteTunnel', async () => {
    const tunnel: Partial<TunnelProvider> = {
      getTunnelByName: vi.fn(async () => ({ id: 't1', name: 'rando-dev' })),
      deleteTunnel: vi.fn(async () => {}),
    }
    const io = captureIo()
    await run(['tunnel', 'delete', 'rando-dev', '-y'], {
      adapters: mockAdapters({ tunnel: tunnel as TunnelProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(tunnel.deleteTunnel).toHaveBeenCalledWith({ tunnelId: 't1' })
  })

  it('tunnel route remove now prompts (retrofit)', async () => {
    const tunnel: Partial<TunnelProvider> = {
      getTunnelByName: vi.fn(async () => ({ id: 't1', name: 'rando-dev' })),
      removeRoute: vi.fn(async () => {}),
    }
    const io = captureIo({ confirm: false })
    await run(['tunnel', 'route', 'remove', 'rando-dev', 'dev-api.rando-id.dev'], {
      adapters: mockAdapters({ tunnel: tunnel as TunnelProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(io.confirmCalls).toHaveLength(1)
    expect(tunnel.removeRoute).not.toHaveBeenCalled()
  })

  it('deploy app delete looks up by name then deletes', async () => {
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async ({ name }) => ({ id: `p_${name}`, name, rootDirectory: null })),
      deleteProject: vi.fn(async () => {}),
    }
    const io = captureIo()
    await run(['deploy', 'app', 'delete', 'rando-api', '--yes'], {
      adapters: mockAdapters({ deploy: deploy as DeployProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(deploy.deleteProject).toHaveBeenCalledWith({ projectId: 'p_rando-api' })
  })

  it('deploy domain remove calls removeDomain', async () => {
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async ({ name }) => ({ id: `p_${name}`, name, rootDirectory: null })),
      removeDomain: vi.fn(async () => {}),
    }
    const io = captureIo()
    await run(['deploy', 'domain', 'remove', 'rando-api', 'staging-api.rando-id.dev', '-y'], {
      adapters: mockAdapters({ deploy: deploy as DeployProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(deploy.removeDomain).toHaveBeenCalledWith({
      projectId: 'p_rando-api',
      hostname: 'staging-api.rando-id.dev',
    })
  })

  it('dns record remove now prompts (retrofit)', async () => {
    const dns: Partial<DnsProvider> = { removeRecord: vi.fn(async () => {}) }
    const io = captureIo({ confirm: false })
    await run(['dns', 'record', 'remove', 'rando-id.dev', 'rec_1'], {
      adapters: mockAdapters({ dns: dns as DnsProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(io.confirmCalls).toHaveLength(1)
    expect(dns.removeRecord).not.toHaveBeenCalled()
  })
})

describe('api postman sync', () => {
  let tmpDir: string
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rando-api-test-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    globalThis.fetch = originalFetch
  })

  function writeSpec(): string {
    const path = join(tmpDir, 'openapi.json')
    writeFileSync(path, JSON.stringify({ openapi: '3.0.0', paths: {} }))
    return path
  }

  // Mocks for the spec-push half of sync — every sync call now hits these too.
  const apiMocks = (): Partial<PostmanProvider> => ({
    findApiByName: vi.fn(async () => null),
    createApi: vi.fn(async () => ({ id: 'api-1', name: 'Rando API' })),
    upsertApiSchema: vi.fn(async () => {}),
  })

  it('replaces an existing collection when one with the same name exists', async () => {
    const postman: Partial<PostmanProvider> = {
      ...apiMocks(),
      findCollectionByName: vi.fn(async () => ({ id: 'c-old', uid: 'u-old', name: 'Rando API' })),
      deleteCollection: vi.fn(async () => {}),
      importOpenApi: vi.fn(async () => ({ id: 'c-new', uid: 'u-new', name: 'Rando API' })),
    }
    const io = captureIo()
    await run(['api', 'postman', 'sync', '--spec', writeSpec(), '--workspace', 'ws-1'], {
      adapters: mockAdapters({ postman: postman as PostmanProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(postman.deleteCollection).toHaveBeenCalledWith('c-old')
    expect(postman.importOpenApi).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      spec: { openapi: '3.0.0', paths: {} },
    })
    const out = io.stdout.join('\n')
    expect(out).toContain('replaced')
    expect(out).toContain('https://web.postman.co/workspace/ws-1/collection/u-new')
  })

  it('creates a new collection when no previous one exists', async () => {
    const postman: Partial<PostmanProvider> = {
      ...apiMocks(),
      findCollectionByName: vi.fn(async () => null),
      deleteCollection: vi.fn(async () => {}),
      importOpenApi: vi.fn(async () => ({ id: 'c-1', uid: 'u-1', name: 'Rando API' })),
    }
    const io = captureIo()
    await run(['api', 'postman', 'sync', '--spec', writeSpec(), '--workspace', 'ws-1'], {
      adapters: mockAdapters({ postman: postman as PostmanProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(postman.deleteCollection).not.toHaveBeenCalled()
    expect(io.stdout.join('\n')).toContain('created')
  })

  it('also pushes the spec as an API entity (v1) alongside the collection', async () => {
    const findApi = vi.fn(async () => null)
    const createApi = vi.fn(async () => ({ id: 'api-1', name: 'Rando API' }))
    const upsertSchema = vi.fn(async () => {})
    const postman: Partial<PostmanProvider> = {
      findApiByName: findApi,
      createApi,
      upsertApiSchema: upsertSchema,
      findCollectionByName: vi.fn(async () => null),
      importOpenApi: vi.fn(async () => ({ id: 'c-1', uid: 'u-1', name: 'Rando API' })),
    }
    const io = captureIo()
    await run(['api', 'postman', 'sync', '--spec', writeSpec(), '--workspace', 'ws-1'], {
      adapters: mockAdapters({ postman: postman as PostmanProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(findApi).toHaveBeenCalledWith({ workspaceId: 'ws-1', name: 'Rando API' })
    expect(createApi).toHaveBeenCalledWith({ workspaceId: 'ws-1', name: 'Rando API' })
    expect(upsertSchema).toHaveBeenCalledWith({
      apiId: 'api-1',
      version: 'v1',
      spec: { openapi: '3.0.0', paths: {} },
    })
  })

  it('soft-skips spec push when the API surface returns an error', async () => {
    const postman: Partial<PostmanProvider> = {
      findApiByName: vi.fn(async () => {
        throw new Error('403 Forbidden: API Builder not enabled on this plan')
      }),
      createApi: vi.fn(),
      upsertApiSchema: vi.fn(),
      findCollectionByName: vi.fn(async () => null),
      importOpenApi: vi.fn(async () => ({ id: 'c-1', uid: 'u-1', name: 'Rando API' })),
    }
    const io = captureIo()
    await run(['api', 'postman', 'sync', '--spec', writeSpec(), '--workspace', 'ws-1'], {
      adapters: mockAdapters({ postman: postman as PostmanProvider }),
      io: io.io,
      exit: noExit,
    })
    // Collection push still succeeded; spec push failed and was noted.
    expect(postman.importOpenApi).toHaveBeenCalled()
    const out = io.stdout.join('\n')
    expect(out).toContain('created')
    expect(out).toContain('spec push to Postman API surface skipped')
    expect(out).toContain('403 Forbidden')
  })

  it('soft-skips with an upgrade-required note when the plan blocks API entities', async () => {
    // Real-world failure: Postman Free tier rejects POST /apis with limitReachedError.
    const postman: Partial<PostmanProvider> = {
      findApiByName: vi.fn(async () => null),
      createApi: vi.fn(async () => {
        throw new PostmanPlanLimitError(
          'You can create up to 0 APIs on your current plan.',
          '{"error":{"name":"limitReachedError"}}',
        )
      }),
      upsertApiSchema: vi.fn(),
      findCollectionByName: vi.fn(async () => null),
      importOpenApi: vi.fn(async () => ({ id: 'c-1', uid: 'u-1', name: 'Rando API' })),
    }
    const io = captureIo()
    await run(['api', 'postman', 'sync', '--spec', writeSpec(), '--workspace', 'ws-1'], {
      adapters: mockAdapters({ postman: postman as PostmanProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(postman.importOpenApi).toHaveBeenCalled()
    const out = io.stdout.join('\n')
    expect(out).toContain('Postman plan blocks API entities')
    expect(out).toContain('upgrade to enable spec push')
    // The raw 400 JSON should NOT leak into the note.
    expect(out).not.toContain('limitReachedError')
  })

  it('fails clearly when no workspace can be resolved', async () => {
    const postman: Partial<PostmanProvider> = {
      findCollectionByName: vi.fn(),
      importOpenApi: vi.fn(),
    }
    const io = captureIo()
    const exitCalls: number[] = []
    await run(
      ['api', 'postman', 'sync', '--spec', writeSpec(), '--config', join(tmpDir, 'missing.json')],
      {
        adapters: mockAdapters({ postman: postman as PostmanProvider }),
        io: io.io,
        exit: ((c: number) => {
          exitCalls.push(c)
        }) as never,
      },
    )
    expect(exitCalls[0]).toBe(1)
    expect(io.stderr.join('\n')).toMatch(/No Postman workspace/)
    expect(postman.findCollectionByName).not.toHaveBeenCalled()
  })

  it('--json emits structured output instead of human summary', async () => {
    const postman: Partial<PostmanProvider> = {
      ...apiMocks(),
      findCollectionByName: vi.fn(async () => null),
      importOpenApi: vi.fn(async () => ({ id: 'c-1', uid: 'u-1', name: 'Rando API' })),
    }
    const io = captureIo()
    await run(['api', 'postman', 'sync', '--spec', writeSpec(), '--workspace', 'ws-1', '--json'], {
      adapters: mockAdapters({ postman: postman as PostmanProvider }),
      io: io.io,
      exit: noExit,
    })
    const json = JSON.parse(io.stdout.join(''))
    expect(json).toMatchObject({
      ok: true,
      replaced: false,
      collection: { uid: 'u-1', name: 'Rando API' },
      api: { id: 'api-1', name: 'Rando API' },
      url: 'https://web.postman.co/workspace/ws-1/collection/u-1',
    })
  })

  it('generate writes a Postman v2.1 collection from a spec file', async () => {
    const specPath = join(tmpDir, 'spec.json')
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/health': {
            get: {
              operationId: 'health',
              tags: ['Health'],
              responses: { '200': { description: 'ok' } },
            },
          },
          '/contacts': {
            get: {
              operationId: 'listContacts',
              tags: ['Contacts'],
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      }),
    )
    const outPath = join(tmpDir, 'c.json')
    const io = captureIo()
    await run(['api', 'postman', 'generate', '--spec', specPath, '--out', outPath], {
      adapters: mockAdapters({}),
      io: io.io,
      exit: noExit,
    })
    const raw = readFileSync(outPath, 'utf-8')
    const parsed = JSON.parse(raw) as {
      info: { name: string; schema: string }
      item: Array<{ name: string }>
    }
    expect(parsed.info.name).toBe('Test API')
    expect(parsed.info.schema).toMatch(/v2\.1\.0/)
    expect(parsed.item.length).toBeGreaterThanOrEqual(2)
    // Volatile fields should be stripped so committed collection files
    // produce clean diffs on regenerate.
    expect(raw).not.toMatch(/"_postman_id"/)
    expect(raw).not.toMatch(/"id":\s*"[0-9a-f-]{36}"/)
  })

  it('generate respects --name override', async () => {
    const specPath = join(tmpDir, 'spec.json')
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Default Title', version: '1.0.0' },
        paths: {
          '/x': { get: { responses: { '200': { description: 'ok' } } } },
        },
      }),
    )
    const outPath = join(tmpDir, 'c.json')
    const io = captureIo()
    await run(
      ['api', 'postman', 'generate', '--spec', specPath, '--out', outPath, '--name', 'Renamed'],
      { adapters: mockAdapters({}), io: io.io, exit: noExit },
    )
    const parsed = JSON.parse(readFileSync(outPath, 'utf-8')) as { info: { name: string } }
    expect(parsed.info.name).toBe('Renamed')
  })

  it('generate refuses to overwrite an existing --out file without --force', async () => {
    const specPath = join(tmpDir, 'spec.json')
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'X', version: '1.0.0' },
        paths: { '/x': { get: { responses: { '200': { description: 'ok' } } } } },
      }),
    )
    const outPath = join(tmpDir, 'existing.json')
    writeFileSync(outPath, '{"hand": "authored"}')
    const io = captureIo()
    const exitCalls: number[] = []
    await run(['api', 'postman', 'generate', '--spec', specPath, '--out', outPath], {
      adapters: mockAdapters({}),
      io: io.io,
      exit: ((c: number) => {
        exitCalls.push(c)
      }) as never,
    })
    expect(exitCalls[0]).toBe(1)
    expect(io.stderr.join('\n')).toMatch(/already exists/)
    // File should be untouched.
    expect(readFileSync(outPath, 'utf-8')).toBe('{"hand": "authored"}')
  })

  it('generate overwrites an existing --out file with --force', async () => {
    const specPath = join(tmpDir, 'spec.json')
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Fresh', version: '1.0.0' },
        paths: { '/x': { get: { responses: { '200': { description: 'ok' } } } } },
      }),
    )
    const outPath = join(tmpDir, 'existing.json')
    writeFileSync(outPath, '{"stale": true}')
    const io = captureIo()
    await run(['api', 'postman', 'generate', '--spec', specPath, '--out', outPath, '--force'], {
      adapters: mockAdapters({}),
      io: io.io,
      exit: noExit,
    })
    const parsed = JSON.parse(readFileSync(outPath, 'utf-8')) as { info: { name: string } }
    expect(parsed.info.name).toBe('Fresh')
  })

  it('generate creates intermediate directories for --out', async () => {
    const specPath = join(tmpDir, 'spec.json')
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'X', version: '1.0.0' },
        paths: { '/x': { get: { responses: { '200': { description: 'ok' } } } } },
      }),
    )
    const outPath = join(tmpDir, 'nested/deeply/c.json')
    const io = captureIo()
    await run(['api', 'postman', 'generate', '--spec', specPath, '--out', outPath], {
      adapters: mockAdapters({}),
      io: io.io,
      exit: noExit,
    })
    expect(readFileSync(outPath, 'utf-8')).toMatch(/"name": "X"/)
  })

  it('reads workspaceId from rando.config.json when --workspace is omitted', async () => {
    const configPath = join(tmpDir, 'rando.config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando',
        domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
        postman: { workspaceId: 'ws-from-config' },
      }),
    )
    const postman: Partial<PostmanProvider> = {
      ...apiMocks(),
      findCollectionByName: vi.fn(async () => null),
      importOpenApi: vi.fn(async () => ({ id: 'c-1', uid: 'u-1', name: 'Rando API' })),
    }
    const io = captureIo()
    await run(['api', 'postman', 'sync', '--spec', writeSpec(), '--config', configPath], {
      adapters: mockAdapters({ postman: postman as PostmanProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(postman.importOpenApi).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-from-config' }),
    )
  })

  // ─── push-spec (standalone) ─────────────────────────────────────────

  it('push-spec creates a new API entity when none exists with that name', async () => {
    const findApi = vi.fn(async () => null)
    const createApi = vi.fn(async () => ({ id: 'api-9', name: 'Rando API' }))
    const upsertSchema = vi.fn(async () => {})
    const postman: Partial<PostmanProvider> = {
      findApiByName: findApi,
      createApi,
      upsertApiSchema: upsertSchema,
    }
    const io = captureIo()
    await run(['api', 'postman', 'push-spec', '--spec', writeSpec(), '--workspace', 'ws-1'], {
      adapters: mockAdapters({ postman: postman as PostmanProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(findApi).toHaveBeenCalledWith({ workspaceId: 'ws-1', name: 'Rando API' })
    expect(createApi).toHaveBeenCalledWith({ workspaceId: 'ws-1', name: 'Rando API' })
    expect(upsertSchema).toHaveBeenCalledWith({
      apiId: 'api-9',
      version: 'v1',
      spec: { openapi: '3.0.0', paths: {} },
    })
    expect(io.stdout.join('\n')).toContain('created API entity Rando API')
  })

  it('push-spec updates the existing API entity when one is already there (idempotent)', async () => {
    const findApi = vi.fn(async () => ({ id: 'api-7', name: 'Rando API' }))
    const createApi = vi.fn()
    const upsertSchema = vi.fn(async () => {})
    const postman: Partial<PostmanProvider> = {
      findApiByName: findApi,
      createApi: createApi as PostmanProvider['createApi'],
      upsertApiSchema: upsertSchema,
    }
    const io = captureIo()
    await run(['api', 'postman', 'push-spec', '--spec', writeSpec(), '--workspace', 'ws-1'], {
      adapters: mockAdapters({ postman: postman as PostmanProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(createApi).not.toHaveBeenCalled()
    expect(upsertSchema).toHaveBeenCalledWith(
      expect.objectContaining({ apiId: 'api-7', version: 'v1' }),
    )
    expect(io.stdout.join('\n')).toContain('updated API entity Rando API')
  })

  it('push-spec respects --version', async () => {
    const upsertSchema = vi.fn(async () => {})
    const postman: Partial<PostmanProvider> = {
      findApiByName: vi.fn(async () => ({ id: 'api-1', name: 'Rando API' })),
      createApi: vi.fn(),
      upsertApiSchema: upsertSchema,
    }
    const io = captureIo()
    await run(
      [
        'api',
        'postman',
        'push-spec',
        '--spec',
        writeSpec(),
        '--workspace',
        'ws-1',
        '--version',
        'v2',
      ],
      { adapters: mockAdapters({ postman: postman as PostmanProvider }), io: io.io, exit: noExit },
    )
    expect(upsertSchema).toHaveBeenCalledWith(expect.objectContaining({ version: 'v2' }))
  })

  it('push-spec --json emits structured output', async () => {
    const postman: Partial<PostmanProvider> = {
      findApiByName: vi.fn(async () => null),
      createApi: vi.fn(async () => ({ id: 'api-9', name: 'Rando API' })),
      upsertApiSchema: vi.fn(async () => {}),
    }
    const io = captureIo()
    await run(
      ['api', 'postman', 'push-spec', '--spec', writeSpec(), '--workspace', 'ws-1', '--json'],
      { adapters: mockAdapters({ postman: postman as PostmanProvider }), io: io.io, exit: noExit },
    )
    expect(JSON.parse(io.stdout.join(''))).toMatchObject({
      ok: true,
      created: true,
      api: { id: 'api-9', name: 'Rando API' },
      version: 'v1',
    })
  })

  it('push-spec surfaces a plan-upgrade message when API entities are blocked', async () => {
    const postman: Partial<PostmanProvider> = {
      findApiByName: vi.fn(async () => null),
      createApi: vi.fn(async () => {
        throw new PostmanPlanLimitError(
          'You can create up to 0 APIs on your current plan.',
          '{"error":{"name":"limitReachedError"}}',
        )
      }),
      upsertApiSchema: vi.fn(),
    }
    const io = captureIo()
    const exitCalls: number[] = []
    await run(['api', 'postman', 'push-spec', '--spec', writeSpec(), '--workspace', 'ws-1'], {
      adapters: mockAdapters({ postman: postman as PostmanProvider }),
      io: io.io,
      exit: ((c: number) => {
        exitCalls.push(c)
      }) as never,
    })
    expect(exitCalls[0]).toBe(1)
    const err = io.stderr.join('\n')
    expect(err).toContain('Postman plan blocks API entities')
    expect(err).toContain('Upgrade to a Postman plan')
    // The raw 400 JSON should NOT leak into the error.
    expect(err).not.toContain('limitReachedError')
  })

  it('push-spec fails clearly when no workspace can be resolved', async () => {
    const postman: Partial<PostmanProvider> = {
      findApiByName: vi.fn(),
      createApi: vi.fn(),
      upsertApiSchema: vi.fn(),
    }
    const io = captureIo()
    const exitCalls: number[] = []
    await run(
      [
        'api',
        'postman',
        'push-spec',
        '--spec',
        writeSpec(),
        '--config',
        join(tmpDir, 'missing.json'),
      ],
      {
        adapters: mockAdapters({ postman: postman as PostmanProvider }),
        io: io.io,
        exit: ((c: number) => {
          exitCalls.push(c)
        }) as never,
      },
    )
    expect(exitCalls[0]).toBe(1)
    expect(io.stderr.join('\n')).toMatch(/No Postman workspace/)
    expect(postman.findApiByName).not.toHaveBeenCalled()
  })

  it('push updates an existing collection (PUT) when one with the same name exists', async () => {
    const collectionPath = join(tmpDir, 'rando-api.postman_collection.json')
    writeFileSync(
      collectionPath,
      JSON.stringify({ info: { name: 'Rando API' }, item: [{ name: 'health' }] }),
    )
    const postman: Partial<PostmanProvider> = {
      findCollectionByName: vi.fn(async () => ({ id: 'c-old', uid: 'u-old', name: 'Rando API' })),
      updateCollection: vi.fn(async () => ({ id: 'c-old', uid: 'u-old', name: 'Rando API' })),
      createCollection: vi.fn(),
    }
    const io = captureIo()
    await run(
      [
        'api',
        'postman',
        'push',
        '--collection',
        collectionPath,
        '--workspace',
        'ws-1',
        '--no-envs',
      ],
      { adapters: mockAdapters({ postman: postman as PostmanProvider }), io: io.io, exit: noExit },
    )
    expect(postman.updateCollection).toHaveBeenCalledWith({
      uid: 'u-old',
      collection: { info: { name: 'Rando API' }, item: [{ name: 'health' }] },
    })
    expect(postman.createCollection).not.toHaveBeenCalled()
    expect(io.stdout.join('\n')).toContain('https://web.postman.co/workspace/ws-1/collection/u-old')
  })

  it('push creates a new collection (POST) when no previous exists', async () => {
    const collectionPath = join(tmpDir, 'c.json')
    writeFileSync(collectionPath, JSON.stringify({ info: { name: 'Rando API' }, item: [] }))
    const postman: Partial<PostmanProvider> = {
      findCollectionByName: vi.fn(async () => null),
      createCollection: vi.fn(async () => ({ id: 'c-new', uid: 'u-new', name: 'Rando API' })),
      updateCollection: vi.fn(),
    }
    const io = captureIo()
    await run(
      [
        'api',
        'postman',
        'push',
        '--collection',
        collectionPath,
        '--workspace',
        'ws-1',
        '--no-envs',
      ],
      { adapters: mockAdapters({ postman: postman as PostmanProvider }), io: io.io, exit: noExit },
    )
    expect(postman.createCollection).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      collection: { info: { name: 'Rando API' }, item: [] },
    })
    expect(postman.updateCollection).not.toHaveBeenCalled()
  })

  it('push also iterates env files in the env-dir and upserts each', async () => {
    const collectionPath = join(tmpDir, 'c.json')
    writeFileSync(collectionPath, JSON.stringify({ info: { name: 'Rando API' }, item: [] }))
    const envDir = join(tmpDir, 'envs')
    mkdirSync(envDir)
    writeFileSync(
      join(envDir, 'local.postman_environment.json'),
      JSON.stringify({ name: 'local', values: [{ key: 'baseUrl', value: 'http://x' }] }),
    )
    writeFileSync(
      join(envDir, 'staging.postman_environment.json'),
      JSON.stringify({ name: 'staging', values: [{ key: 'baseUrl', value: 'https://y' }] }),
    )
    // a non-env file that should be ignored
    writeFileSync(join(envDir, 'README.md'), 'noise')

    const postman: Partial<PostmanProvider> = {
      findCollectionByName: vi.fn(async () => null),
      createCollection: vi.fn(async () => ({ id: 'c', uid: 'uc', name: 'Rando API' })),
      findEnvironmentByName: vi.fn(async ({ name }) =>
        name === 'staging' ? { id: 'es', uid: 'us', name: 'staging' } : null,
      ),
      createEnvironment: vi.fn(async () => ({ id: 'e', uid: 'ue', name: 'local' })),
      updateEnvironment: vi.fn(async () => ({ id: 'es', uid: 'us', name: 'staging' })),
    }
    const io = captureIo()
    await run(
      [
        'api',
        'postman',
        'push',
        '--collection',
        collectionPath,
        '--env-dir',
        envDir,
        '--workspace',
        'ws-1',
      ],
      { adapters: mockAdapters({ postman: postman as PostmanProvider }), io: io.io, exit: noExit },
    )
    expect(postman.createEnvironment).toHaveBeenCalledTimes(1)
    expect(postman.updateEnvironment).toHaveBeenCalledTimes(1)
    expect(postman.findEnvironmentByName).toHaveBeenCalledTimes(2) // only the two json files
  })

  it('push errors with exit code 1 when the collection file is missing', async () => {
    const postman: Partial<PostmanProvider> = {
      findCollectionByName: vi.fn(),
      createCollection: vi.fn(),
    }
    const io = captureIo()
    const exitCalls: number[] = []
    await run(
      ['api', 'postman', 'push', '--collection', join(tmpDir, 'nope.json'), '--workspace', 'ws-1'],
      {
        adapters: mockAdapters({ postman: postman as PostmanProvider }),
        io: io.io,
        exit: ((c: number) => {
          exitCalls.push(c)
        }) as never,
      },
    )
    expect(exitCalls[0]).toBe(1)
    expect(io.stderr.join('\n')).toMatch(/Collection file not found/)
    expect(postman.createCollection).not.toHaveBeenCalled()
  })
})

describe('secrets sync', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rando-secrets-test-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeConfig(): string {
    const configPath = join(tmpDir, 'rando.config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando',
        domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
        secrets: {
          kind: '1password',
          account: 'AAAA',
          field: 'credential',
          environments: { local: 'env-local', staging: 'env-staging', prod: 'env-prod' },
        },
      }),
    )
    return configPath
  }

  it('fetches declared root vars from 1Password and writes to .env', async () => {
    const configPath = writeConfig()
    writeFileSync(join(tmpDir, '.env.example'), 'GITHUB_TOKEN=\nNEON_API_KEY=\n')

    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'dev@rando.id', url: 'https://x' })),
      readEnvironment: vi.fn(async (envId: string) => {
        if (envId !== 'env-local') throw new Error(`unexpected envId ${envId}`)
        return { GITHUB_TOKEN: 'gh-secret-value', NEON_API_KEY: 'neon-secret-value' }
      }),
    }
    const io = captureIo()
    await run(['secrets', 'sync', '--config', configPath], {
      adapters: mockAdapters({ secrets: secrets as SecretsProvider }),
      io: io.io,
      exit: noExit,
    })
    const written = readFileSync(join(tmpDir, '.env'), 'utf-8')
    expect(written).toMatch(/^GITHUB_TOKEN=gh-secret-value$/m)
    expect(written).toMatch(/^NEON_API_KEY=neon-secret-value$/m)
    expect(io.stdout.join('\n')).toMatch(/2 fetched/)
  })

  it("writes per-app .env files scoped by each app's .env.example", async () => {
    const configPath = writeConfig()
    writeFileSync(join(tmpDir, '.env.example'), 'NEON_API_KEY=\n')
    const apiDir = join(tmpDir, 'apps', 'api')
    mkdirSync(apiDir, { recursive: true })
    writeFileSync(
      join(apiDir, '.env.example'),
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=\nCLERK_SECRET_KEY=\n',
    )

    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      readEnvironment: vi.fn(async () => ({
        NEON_API_KEY: 'neon',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_abc',
        CLERK_SECRET_KEY: 'sk_test_xyz',
        // Extra value that no .env.example declares — should NOT be
        // written anywhere (cross-pollination guard).
        SOME_OTHER_VAR: 'leak',
      })),
    }
    const io = captureIo()
    await run(['secrets', 'sync', '--config', configPath], {
      adapters: mockAdapters({ secrets: secrets as SecretsProvider }),
      io: io.io,
      exit: noExit,
    })
    const root = readFileSync(join(tmpDir, '.env'), 'utf-8')
    const app = readFileSync(join(apiDir, '.env'), 'utf-8')
    expect(root).toMatch(/^NEON_API_KEY=neon$/m)
    expect(root).not.toMatch(/CLERK/)
    expect(root).not.toMatch(/SOME_OTHER_VAR/)
    expect(app).toMatch(/^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_abc$/m)
    expect(app).toMatch(/^CLERK_SECRET_KEY=sk_test_xyz$/m)
    expect(app).not.toMatch(/NEON_API_KEY/)
    expect(app).not.toMatch(/SOME_OTHER_VAR/)
  })

  it('skips an app when it has no .env.example', async () => {
    const configPath = writeConfig()
    writeFileSync(join(tmpDir, '.env.example'), 'NEON_API_KEY=\n')
    // apps/api dir exists but no .env.example — should be skipped silently
    mkdirSync(join(tmpDir, 'apps', 'api'), { recursive: true })

    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      readEnvironment: vi.fn(async () => ({ NEON_API_KEY: 'neon' })),
    }
    const io = captureIo()
    await run(['secrets', 'sync', '--config', configPath], {
      adapters: mockAdapters({ secrets: secrets as SecretsProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(io.stdout.join('\n')).toMatch(/api:.*no \.env\.example/)
    expect(existsSync(join(tmpDir, 'apps', 'api', '.env'))).toBe(false)
  })

  it('skips vars already set in .env unless --force', async () => {
    const configPath = writeConfig()
    writeFileSync(join(tmpDir, '.env.example'), 'NEON_API_KEY=\n')
    writeFileSync(join(tmpDir, '.env'), 'NEON_API_KEY=already-here\n')

    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      readEnvironment: vi.fn(async () => ({ NEON_API_KEY: 'from-vault' })),
    }
    const io = captureIo()
    await run(['secrets', 'sync', '--config', configPath], {
      adapters: mockAdapters({ secrets: secrets as SecretsProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(readFileSync(join(tmpDir, '.env'), 'utf-8')).toMatch(/^NEON_API_KEY=already-here$/m)
    expect(io.stdout.join('\n')).toMatch(/already set/)
  })

  it('--force overwrites existing values', async () => {
    const configPath = writeConfig()
    writeFileSync(join(tmpDir, '.env.example'), 'NEON_API_KEY=\n')
    writeFileSync(join(tmpDir, '.env'), 'NEON_API_KEY=stale\n')

    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      readEnvironment: vi.fn(async () => ({ NEON_API_KEY: 'fresh' })),
    }
    const io = captureIo()
    await run(['secrets', 'sync', '--config', configPath, '--force'], {
      adapters: mockAdapters({ secrets: secrets as SecretsProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(readFileSync(join(tmpDir, '.env'), 'utf-8')).toMatch(/^NEON_API_KEY=fresh$/m)
  })

  it('errors clearly when no secrets block exists in rando.config.json', async () => {
    const configPath = join(tmpDir, 'rando.config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando',
        domains: { nonProd: 'a', production: 'b' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
      }),
    )

    const io = captureIo()
    const exitCalls: number[] = []
    await run(['secrets', 'sync', '--config', configPath], {
      adapters: mockAdapters({ secrets: { whoami: vi.fn() } as unknown as SecretsProvider }),
      io: io.io,
      exit: ((c: number) => exitCalls.push(c)) as never,
    })
    expect(exitCalls[0]).toBe(1)
    expect(io.stderr.join('\n')).toMatch(/No `secrets` block/)
  })
})

describe('secrets sync --env', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rando-sync-env-test-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads from the staging 1P environment when --env staging is passed', async () => {
    const configPath = join(tmpDir, 'rando.config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando',
        domains: { nonProd: 'a', production: 'b' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
        secrets: {
          kind: '1password',
          field: 'credential',
          environments: { local: 'env-local', staging: 'env-staging' },
        },
      }),
    )
    writeFileSync(join(tmpDir, '.env.example'), 'NEON_API_KEY=\n')

    const reads: string[] = []
    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      readEnvironment: vi.fn(async (envId: string) => {
        reads.push(envId)
        return { NEON_API_KEY: 'staging-val' }
      }),
    }
    const io = captureIo()
    await run(['secrets', 'sync', '--config', configPath, '--env', 'staging'], {
      adapters: mockAdapters({ secrets: secrets as SecretsProvider }),
      io: io.io,
      exit: noExit,
    })
    expect(reads).toEqual(['env-staging'])
    expect(readFileSync(join(tmpDir, '.env'), 'utf-8')).toMatch(/^NEON_API_KEY=staging-val$/m)
  })

  it('errors when --env points at an env without a configured vault', async () => {
    const configPath = join(tmpDir, 'rando.config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando',
        domains: { nonProd: 'a', production: 'b' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
        secrets: {
          kind: '1password',
          field: 'credential',
          environments: { local: 'vault-local' },
        },
      }),
    )
    const envFile = join(tmpDir, '.env')
    writeFileSync(envFile, '')

    const io = captureIo()
    const exitCalls: number[] = []
    await run(['secrets', 'sync', '--config', configPath, '--env', 'prod'], {
      adapters: mockAdapters({
        secrets: {
          whoami: vi.fn(async () => ({ account: '', url: '' })),
        } as unknown as SecretsProvider,
      }),
      io: io.io,
      exit: ((c: number) => exitCalls.push(c)) as never,
    })
    expect(exitCalls[0]).toBe(1)
    expect(io.stderr.join('\n')).toMatch(/No environment configured for "prod"/)
  })
})

describe('secrets set', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rando-set-test-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeConfig(): string {
    const configPath = join(tmpDir, 'rando.config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando',
        domains: { nonProd: 'a', production: 'b' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
        secrets: {
          kind: '1password',
          field: 'credential',
          environments: { local: 'v-local', staging: 'v-staging', prod: 'v-prod' },
        },
      }),
    )
    return configPath
  }

  it('writes to a single env when --env <name> is passed', async () => {
    const configPath = writeConfig()
    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      write: vi.fn(async () => {}),
    }
    const io = captureIo()
    await run(
      [
        'secrets',
        'set',
        'NEW_KEY',
        '--value',
        'the-value',
        '--env',
        'local',
        '--config',
        configPath,
      ],
      { adapters: mockAdapters({ secrets: secrets as SecretsProvider }), io: io.io, exit: noExit },
    )
    expect(secrets.write).toHaveBeenCalledTimes(1)
    expect(secrets.write).toHaveBeenCalledWith({
      vault: 'v-local',
      item: 'NEW_KEY',
      field: 'credential',
      value: 'the-value',
    })
  })

  it('writes to every configured env with --all', async () => {
    const configPath = writeConfig()
    const writes: Array<{ vault: string }> = []
    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      write: vi.fn(async (input: { vault: string }) => {
        writes.push(input)
      }),
    }
    const io = captureIo()
    await run(
      ['secrets', 'set', 'GLOBAL_KEY', '--value', 'shared', '--all', '--config', configPath],
      { adapters: mockAdapters({ secrets: secrets as SecretsProvider }), io: io.io, exit: noExit },
    )
    expect(writes.map((w) => w.vault).sort()).toEqual(['v-local', 'v-prod', 'v-staging'])
  })

  it('accepts a comma-separated list via --env', async () => {
    const configPath = writeConfig()
    const writes: Array<{ vault: string }> = []
    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      write: vi.fn(async (input: { vault: string }) => {
        writes.push(input)
      }),
    }
    const io = captureIo()
    await run(
      ['secrets', 'set', 'SHARED', '--value', 'x', '--env', 'staging,prod', '--config', configPath],
      { adapters: mockAdapters({ secrets: secrets as SecretsProvider }), io: io.io, exit: noExit },
    )
    expect(writes.map((w) => w.vault).sort()).toEqual(['v-prod', 'v-staging'])
  })

  it('rejects --env targeting an env without a vault configured', async () => {
    const configPath = join(tmpDir, 'partial.config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando',
        domains: { nonProd: 'a', production: 'b' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
        secrets: {
          kind: '1password',
          field: 'credential',
          environments: { local: 'v-local' },
        },
      }),
    )
    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      write: vi.fn(),
    }
    const io = captureIo()
    const exitCalls: number[] = []
    await run(['secrets', 'set', 'K', '--value', 'v', '--env', 'staging', '--config', configPath], {
      adapters: mockAdapters({ secrets: secrets as SecretsProvider }),
      io: io.io,
      exit: ((c: number) => exitCalls.push(c)) as never,
    })
    expect(exitCalls[0]).toBe(1)
    expect(io.stderr.join('\n')).toMatch(/No environment configured for "staging"/)
    expect(secrets.write).not.toHaveBeenCalled()
  })
})

describe('secrets push', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rando-push-test-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeConfig(): string {
    const configPath = join(tmpDir, 'rando.config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando',
        domains: { nonProd: 'a', production: 'b' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
        secrets: {
          kind: '1password',
          field: 'credential',
          environments: { local: 'v-local', staging: 'v-staging' },
        },
      }),
    )
    return configPath
  }

  it('reads from the local vault by default and writes to GitHub repo secret', async () => {
    const configPath = writeConfig()
    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      read: vi.fn(async () => 'the-token-value'),
    }
    const gh: Partial<GhProvider> = {
      whoami: vi.fn(async () => ({ login: 'newton' })),
      setRepoSecret: vi.fn(async () => {}),
    }
    const io = captureIo()
    await run(['secrets', 'push', 'OP_SERVICE_ACCOUNT_TOKEN', '--config', configPath], {
      adapters: mockAdapters({
        secrets: secrets as SecretsProvider,
        gh: gh as GhProvider,
      }),
      io: io.io,
      exit: noExit,
    })
    expect(secrets.read).toHaveBeenCalledWith('op://v-local/OP_SERVICE_ACCOUNT_TOKEN/credential')
    expect(gh.setRepoSecret).toHaveBeenCalledWith({
      repo: 'rando-id/rando',
      name: 'OP_SERVICE_ACCOUNT_TOKEN',
      value: 'the-token-value',
    })
  })

  it('reads from the staging vault when --from staging is passed', async () => {
    const configPath = writeConfig()
    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      read: vi.fn(async () => 'staging-token'),
    }
    const gh: Partial<GhProvider> = {
      whoami: vi.fn(async () => ({ login: 'n' })),
      setRepoSecret: vi.fn(async () => {}),
    }
    await run(['secrets', 'push', 'API_KEY', '--from', 'staging', '--config', configPath], {
      adapters: mockAdapters({
        secrets: secrets as SecretsProvider,
        gh: gh as GhProvider,
      }),
      io: captureIo().io,
      exit: noExit,
    })
    expect(secrets.read).toHaveBeenCalledWith('op://v-staging/API_KEY/credential')
  })

  it('--ref overrides the vault/env convention', async () => {
    const configPath = writeConfig()
    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      read: vi.fn(async () => 'personal-vault-value'),
    }
    const gh: Partial<GhProvider> = {
      whoami: vi.fn(async () => ({ login: 'n' })),
      setRepoSecret: vi.fn(async () => {}),
    }
    await run(
      [
        'secrets',
        'push',
        'OP_SERVICE_ACCOUNT_TOKEN',
        '--ref',
        'op://Personal/SAToken/credential',
        '--config',
        configPath,
      ],
      {
        adapters: mockAdapters({
          secrets: secrets as SecretsProvider,
          gh: gh as GhProvider,
        }),
        io: captureIo().io,
        exit: noExit,
      },
    )
    expect(secrets.read).toHaveBeenCalledWith('op://Personal/SAToken/credential')
  })

  it('--repo overrides the rando.config.json repo', async () => {
    const configPath = writeConfig()
    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      read: vi.fn(async () => 'v'),
    }
    const gh: Partial<GhProvider> = {
      whoami: vi.fn(async () => ({ login: 'n' })),
      setRepoSecret: vi.fn(async () => {}),
    }
    await run(
      ['secrets', 'push', 'K', '--repo', 'other-owner/other-repo', '--config', configPath],
      {
        adapters: mockAdapters({
          secrets: secrets as SecretsProvider,
          gh: gh as GhProvider,
        }),
        io: captureIo().io,
        exit: noExit,
      },
    )
    expect(gh.setRepoSecret).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'other-owner/other-repo' }),
    )
  })

  it('refuses to push an empty value', async () => {
    const configPath = writeConfig()
    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'd', url: 'u' })),
      read: vi.fn(async () => '   '),
    }
    const gh: Partial<GhProvider> = {
      whoami: vi.fn(async () => ({ login: 'n' })),
      setRepoSecret: vi.fn(),
    }
    const io = captureIo()
    const exitCalls: number[] = []
    await run(['secrets', 'push', 'K', '--config', configPath], {
      adapters: mockAdapters({
        secrets: secrets as SecretsProvider,
        gh: gh as GhProvider,
      }),
      io: io.io,
      exit: ((c: number) => exitCalls.push(c)) as never,
    })
    expect(exitCalls[0]).toBe(1)
    expect(io.stderr.join('\n')).toMatch(/Empty value/)
    expect(gh.setRepoSecret).not.toHaveBeenCalled()
  })
})

// The clerk command resolves CLERK_SECRET_KEY from 1P then constructs
// a ClerkCliAdapter. Stub the adapter at the module level so we can
// drive each subcommand without shelling out to `npx clerk@latest`.
const clerkMocks = vi.hoisted(() => ({
  whoami: vi.fn(),
  ensureSvixApp: vi.fn(),
  getSvixDashboardUrl: vi.fn(),
  createUser: vi.fn(),
}))
vi.mock('../adapters/clerk-cli', () => ({
  ClerkCliAdapter: class {
    whoami = clerkMocks.whoami
    ensureSvixApp = clerkMocks.ensureSvixApp
    getSvixDashboardUrl = clerkMocks.getSvixDashboardUrl
    createUser = clerkMocks.createUser
  },
}))

describe('clerk commands', () => {
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = mkdtempSync(join(tmpdir(), 'rando-clerk-test-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeConfig(): string {
    const configPath = join(tmpDir, 'rando.config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando',
        domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
        secrets: {
          kind: '1password',
          field: 'credential',
          environments: { local: 'env-local', staging: 'env-staging', prod: 'env-prod' },
        },
      }),
    )
    return configPath
  }

  function secretsStub(values: Record<string, string>): Partial<SecretsProvider> {
    return {
      whoami: vi.fn(async () => ({ account: 'dev', url: 'u' })),
      readEnvironment: vi.fn(async () => values),
    }
  }

  it('clerk whoami probes /users/count and reports the total', async () => {
    const configPath = writeConfig()
    clerkMocks.whoami.mockResolvedValue({ count: 12 })

    const io = captureIo()
    await run(['clerk', 'whoami', '--config', configPath, '--env', 'local'], {
      adapters: mockAdapters({
        secrets: secretsStub({ CLERK_SECRET_KEY: 'sk_test_FAKE' }) as SecretsProvider,
      }),
      io: io.io,
      exit: noExit,
    })
    expect(clerkMocks.whoami).toHaveBeenCalledTimes(1)
    expect(io.stdout.join('\n')).toMatch(/12 user/)
  })

  it('clerk whoami errors when CLERK_SECRET_KEY is empty in the 1P environment', async () => {
    const configPath = writeConfig()
    const io = captureIo()
    const exitCalls: number[] = []
    await run(['clerk', 'whoami', '--config', configPath, '--env', 'staging'], {
      adapters: mockAdapters({
        secrets: secretsStub({}) as SecretsProvider,
      }),
      io: io.io,
      exit: ((c: number) => exitCalls.push(c)) as never,
    })
    expect(exitCalls[0]).toBe(1)
    expect(io.stderr.join('\n')).toMatch(/CLERK_SECRET_KEY is empty/)
  })

  it('clerk users create POSTs the user and prints the new id', async () => {
    const configPath = writeConfig()
    clerkMocks.createUser.mockResolvedValue({ id: 'user_abc', email: 'ada@example.com' })

    const io = captureIo()
    await run(
      [
        'clerk',
        'users',
        'create',
        '--config',
        configPath,
        '--env',
        'staging',
        '--email',
        'ada@example.com',
        '--password',
        'pw_1234567',
        '--first-name',
        'Ada',
      ],
      {
        adapters: mockAdapters({
          secrets: secretsStub({ CLERK_SECRET_KEY: 'sk_test_FAKE' }) as SecretsProvider,
        }),
        io: io.io,
        exit: noExit,
      },
    )
    expect(clerkMocks.createUser).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'pw_1234567',
      firstName: 'Ada',
      lastName: undefined,
    })
    expect(io.stdout.join('\n')).toMatch(/ada@example\.com/)
  })

  it('clerk webhook setup ensures the Svix app, prompts for the secret, and pushes everywhere', async () => {
    const configPath = writeConfig()
    clerkMocks.ensureSvixApp.mockResolvedValue({ alreadyExists: false })
    clerkMocks.getSvixDashboardUrl.mockResolvedValue({
      url: 'https://app.svix.com/login#token=abc',
    })

    const opWrite = vi.fn(async () => undefined)
    const secrets: Partial<SecretsProvider> = {
      whoami: vi.fn(async () => ({ account: 'dev', url: 'u' })),
      readEnvironment: vi.fn(async () => ({ CLERK_SECRET_KEY: 'sk_test_FAKE' })),
      write: opWrite,
    }
    const setEnv = vi.fn(async () => ({
      id: 'env_1',
      key: 'CLERK_WEBHOOK_SECRET',
      scopes: ['preview' as const],
    }))
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async () => ({
        id: 'p_rando-api',
        name: 'rando-api',
        rootDirectory: null,
      })),
      setEnv,
    }
    // Drive io.input to return the signing secret on the single prompt.
    const io = captureIo({ inputResponses: ['whsec_abc123'] })
    await run(['clerk', 'webhook', 'setup', '--config', configPath, '--env', 'staging'], {
      adapters: mockAdapters({
        secrets: secrets as SecretsProvider,
        deploy: deploy as DeployProvider,
      }),
      io: io.io,
      exit: noExit,
    })
    expect(clerkMocks.ensureSvixApp).toHaveBeenCalledTimes(1)
    expect(clerkMocks.getSvixDashboardUrl).toHaveBeenCalledTimes(1)
    expect(opWrite).toHaveBeenCalledWith({
      vault: 'env-staging',
      item: 'CLERK_WEBHOOK_SECRET',
      field: 'credential',
      value: 'whsec_abc123',
    })
    expect(setEnv).toHaveBeenCalledWith({
      projectId: 'p_rando-api',
      key: 'CLERK_WEBHOOK_SECRET',
      value: 'whsec_abc123',
      scopes: ['preview'],
    })
  })

  it('clerk webhook setup refuses signing secrets without the whsec_ prefix', async () => {
    const configPath = writeConfig()
    clerkMocks.ensureSvixApp.mockResolvedValue({ alreadyExists: true })
    clerkMocks.getSvixDashboardUrl.mockResolvedValue({ url: 'https://app.svix.com/login' })

    const io = captureIo({ inputResponses: ['not-a-whsec-value'] })
    const exitCalls: number[] = []
    await run(['clerk', 'webhook', 'setup', '--config', configPath, '--env', 'staging'], {
      adapters: mockAdapters({
        secrets: secretsStub({ CLERK_SECRET_KEY: 'sk_test_FAKE' }) as SecretsProvider,
      }),
      io: io.io,
      exit: ((c: number) => exitCalls.push(c)) as never,
    })
    expect(exitCalls[0]).toBe(1)
    expect(io.stderr.join('\n')).toMatch(/whsec_/)
  })
})

// Reference for unused-symbol linter — ClerkProvider type is imported
// so future tests that need a more elaborate stub can reach for it.
void ({} as Partial<ClerkProvider>)
