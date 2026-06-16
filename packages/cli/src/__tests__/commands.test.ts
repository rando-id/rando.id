import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../cli'
import type { Adapters } from '../config'
import type { DbProvider } from '../domain/db'
import type { DeployProvider } from '../domain/deploy'
import type { DnsProvider } from '../domain/dns'
import type { PostmanProvider } from '../domain/postman'
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
  }>,
): Adapters {
  return {
    db: () => overrides.db ?? notConfigured('db'),
    tunnel: () => overrides.tunnel ?? notConfigured('tunnel'),
    dns: () => overrides.dns ?? notConfigured('dns'),
    deploy: () => overrides.deploy ?? notConfigured('deploy'),
    tracker: () => overrides.tracker ?? notConfigured('tracker'),
    postman: () => overrides.postman ?? notConfigured('postman'),
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

  it('replaces an existing collection when one with the same name exists', async () => {
    const postman: Partial<PostmanProvider> = {
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
