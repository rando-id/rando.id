import { describe, expect, it, vi } from 'vitest'
import { run } from '../cli'
import type { Adapters } from '../config'
import type { DbProvider } from '../domain/db'
import type { DeployProvider } from '../domain/deploy'
import type { DnsProvider } from '../domain/dns'
import type { TunnelProvider } from '../domain/tunnel'
import { captureIo } from './helpers'

// Build a fake Adapters object with only the providers a given test needs.
function mockAdapters(
  overrides: Partial<{
    db: DbProvider
    tunnel: TunnelProvider
    dns: DnsProvider
    deploy: DeployProvider
  }>,
): Adapters {
  return {
    db: () => overrides.db ?? notConfigured('db'),
    tunnel: () => overrides.tunnel ?? notConfigured('tunnel'),
    dns: () => overrides.dns ?? notConfigured('dns'),
    deploy: () => overrides.deploy ?? notConfigured('deploy'),
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
