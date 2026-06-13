import { describe, expect, it, vi } from 'vitest'
import {
  ProductionDestroyForbiddenError,
  runDestroy,
  runSetup,
  type SetupEvent,
} from '../orchestrate'
import type { DbProvider } from '../domain/db'
import type { DeployProvider } from '../domain/deploy'
import type { DnsProvider } from '../domain/dns'
import type { TunnelProvider } from '../domain/tunnel'
import { ProviderApiError } from '../domain/errors'
import type { SetupConfig } from '../setup-config'

const config: SetupConfig = {
  project: 'rando',
  repo: 'me/rando',
  tunnel: 'rando-dev',
  domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
  apps: [
    { name: 'api', rootDirectory: 'apps/api', port: 4000, prodApex: false },
    { name: 'web', rootDirectory: 'apps/web', port: 3000, prodApex: true },
  ],
}

function captureEvents() {
  const events: SetupEvent[] = []
  return { events, emit: (e: SetupEvent) => events.push(e) }
}

function messages(events: SetupEvent[]): string[] {
  return events.map((e) => `${e.kind}: ${e.message}`)
}

describe('runSetup — dev env', () => {
  it('creates the tunnel and adds a route per app, skipping existing ones', async () => {
    const tunnel: TunnelProvider = {
      getTunnelByName: vi.fn(async () => null),
      createTunnel: vi.fn(async ({ name }) => ({ id: 't1', name })),
      listTunnels: vi.fn(),
      getTunnelToken: vi.fn(),
      addRoute: vi.fn(async ({ hostname, service }) => ({
        id: hostname,
        hostname,
        service,
      })),
      listRoutes: vi.fn(async () => [
        {
          id: 'dev-api.rando-id.dev',
          hostname: 'dev-api.rando-id.dev',
          service: 'old',
        },
      ]),
      removeRoute: vi.fn(),
      deleteTunnel: vi.fn(),
    }
    const { events, emit } = captureEvents()
    await runSetup(stubAll({ tunnel }), { config, envs: ['dev'], apps: [], emit })
    expect(tunnel.createTunnel).toHaveBeenCalledWith({ name: 'rando-dev' })
    // api route already existed → should be skipped
    expect(tunnel.addRoute).toHaveBeenCalledTimes(1)
    expect(tunnel.addRoute).toHaveBeenCalledWith({
      tunnelId: 't1',
      hostname: 'dev-web.rando-id.dev',
      service: 'http://host.docker.internal:3000',
    })
    expect(messages(events)).toContainEqual(
      'step-skip: tunnel route dev-api.rando-id.dev already exists',
    )
    expect(messages(events).some((m) => m.startsWith('note: tunnel token'))).toBe(true)
  })

  it('skips tunnel creation when it already exists', async () => {
    const tunnel: TunnelProvider = {
      getTunnelByName: vi.fn(async () => ({ id: 't1', name: 'rando-dev' })),
      createTunnel: vi.fn(),
      listTunnels: vi.fn(),
      getTunnelToken: vi.fn(),
      addRoute: vi.fn(async ({ hostname, service }) => ({
        id: hostname,
        hostname,
        service,
      })),
      listRoutes: vi.fn(async () => []),
      removeRoute: vi.fn(),
      deleteTunnel: vi.fn(),
    }
    const { events, emit } = captureEvents()
    await runSetup(stubAll({ tunnel }), { config, envs: ['dev'], apps: [], emit })
    expect(tunnel.createTunnel).not.toHaveBeenCalled()
    expect(messages(events)).toContainEqual('step-skip: tunnel "rando-dev" already exists (t1)')
  })
})

describe('runSetup — staging env', () => {
  it('creates Neon staging branch + Vercel projects + Vercel domains + DNS', async () => {
    const db: DbProvider = {
      createProject: vi.fn(),
      listProjects: vi.fn(async () => [{ id: 'p1', name: 'rando' }]),
      createBranch: vi.fn(async ({ name }) => ({
        id: 'br_staging',
        name,
        parentId: 'br_main',
        createdAt: 'x',
      })),
      listBranches: vi.fn(async () => [
        { id: 'br_main', name: 'main', parentId: null, createdAt: 'x' },
      ]),
      getConnectionString: vi.fn(),
      enableExtension: vi.fn(async () => undefined),
      deleteBranch: vi.fn(),
      deleteProject: vi.fn(),
      resetBranch: vi.fn(),
    }
    const deploy: DeployProvider = {
      createProject: vi.fn(async ({ name, rootDirectory }) => ({
        id: `p_${name}`,
        name,
        rootDirectory,
      })),
      listProjects: vi.fn(),
      getProjectByName: vi.fn(async () => null),
      setEnv: vi.fn(),
      listEnv: vi.fn(),
      addDomain: vi.fn(async ({ hostname, branch }) => ({
        name: hostname,
        branch: branch ?? null,
      })),
      removeDomain: vi.fn(),
      deleteProject: vi.fn(),
      triggerDeployment: vi.fn(),
      getDeployment: vi.fn(),
    }
    const dns: DnsProvider = {
      addRecord: vi.fn(async (input) => ({
        id: 'rec_1',
        type: input.type,
        name: input.name,
        content: input.content,
        ttl: 1,
        proxied: false,
      })),
      listRecords: vi.fn(async () => []),
      removeRecord: vi.fn(),
    }
    const { emit } = captureEvents()
    await runSetup(stubAll({ db, deploy, dns }), { config, envs: ['staging'], apps: [], emit })

    expect(db.createBranch).toHaveBeenCalledWith({
      projectId: 'p1',
      name: 'staging',
      fromBranchId: 'br_main',
    })
    expect(db.enableExtension).toHaveBeenCalledWith({
      projectId: 'p1',
      branchId: 'br_staging',
      extension: 'postgis',
    })

    // Per app: vercel project + domain + DNS
    expect(deploy.createProject).toHaveBeenCalledTimes(2)
    expect(deploy.addDomain).toHaveBeenCalledWith({
      projectId: 'p_rando-api',
      hostname: 'staging-api.rando-id.dev',
      branch: 'staging',
    })
    expect(dns.addRecord).toHaveBeenCalledWith({
      zone: 'rando-id.dev',
      type: 'CNAME',
      name: 'staging-api',
      content: 'cname.vercel-dns.com',
    })
  })

  it('skips Vercel projects that already exist and treats 409 domains as already-configured', async () => {
    const db: DbProvider = {
      createProject: vi.fn(),
      listProjects: vi.fn(async () => [{ id: 'p1', name: 'rando' }]),
      createBranch: vi.fn(),
      listBranches: vi.fn(async () => [
        { id: 'br_main', name: 'main', parentId: null, createdAt: 'x' },
        { id: 'br_staging', name: 'staging', parentId: 'br_main', createdAt: 'x' },
      ]),
      getConnectionString: vi.fn(),
      enableExtension: vi.fn(async () => undefined),
      deleteBranch: vi.fn(),
      deleteProject: vi.fn(),
      resetBranch: vi.fn(),
    }
    const deploy: DeployProvider = {
      createProject: vi.fn(),
      listProjects: vi.fn(),
      getProjectByName: vi.fn(async ({ name }) => ({ id: `p_${name}`, name, rootDirectory: null })),
      setEnv: vi.fn(),
      listEnv: vi.fn(),
      addDomain: vi.fn(async () => {
        throw new ProviderApiError('vercel', 409, 'domain already in use')
      }),
      removeDomain: vi.fn(),
      deleteProject: vi.fn(),
      triggerDeployment: vi.fn(),
      getDeployment: vi.fn(),
    }
    const dns: DnsProvider = {
      addRecord: vi.fn(),
      listRecords: vi.fn(async () => []),
      removeRecord: vi.fn(),
    }
    const { events, emit } = captureEvents()
    await runSetup(stubAll({ db, deploy, dns }), { config, envs: ['staging'], apps: ['api'], emit })
    expect(deploy.createProject).not.toHaveBeenCalled()
    expect(db.createBranch).not.toHaveBeenCalled()
    expect(messages(events)).toContainEqual(
      'step-skip: vercel domain staging-api.rando-id.dev already configured',
    )
  })
})

describe('runSetup — production env', () => {
  it('apex apps get @ DNS record', async () => {
    const db: DbProvider = {
      createProject: vi.fn(),
      listProjects: vi.fn(async () => [{ id: 'p1', name: 'rando' }]),
      createBranch: vi.fn(),
      listBranches: vi.fn(async () => [
        { id: 'br_main', name: 'main', parentId: null, createdAt: 'x' },
      ]),
      getConnectionString: vi.fn(),
      enableExtension: vi.fn(async () => undefined),
      deleteBranch: vi.fn(),
      deleteProject: vi.fn(),
      resetBranch: vi.fn(),
    }
    const deploy: DeployProvider = {
      createProject: vi.fn(async ({ name, rootDirectory }) => ({
        id: `p_${name}`,
        name,
        rootDirectory,
      })),
      listProjects: vi.fn(),
      getProjectByName: vi.fn(async () => null),
      setEnv: vi.fn(),
      listEnv: vi.fn(),
      addDomain: vi.fn(async ({ hostname, branch }) => ({
        name: hostname,
        branch: branch ?? null,
      })),
      removeDomain: vi.fn(),
      deleteProject: vi.fn(),
      triggerDeployment: vi.fn(),
      getDeployment: vi.fn(),
    }
    const dns: DnsProvider = {
      addRecord: vi.fn(async (input) => ({
        id: 'rec_1',
        type: input.type,
        name: input.name,
        content: input.content,
        ttl: 1,
        proxied: false,
      })),
      listRecords: vi.fn(async () => []),
      removeRecord: vi.fn(),
    }
    const { emit } = captureEvents()
    await runSetup(stubAll({ db, deploy, dns }), {
      config,
      envs: ['production'],
      apps: ['web'],
      emit,
    })
    expect(dns.addRecord).toHaveBeenCalledWith({
      zone: 'rando.id',
      type: 'CNAME',
      name: '@',
      content: 'cname.vercel-dns.com',
    })
    expect(deploy.addDomain).toHaveBeenCalledWith({
      projectId: 'p_rando-web',
      hostname: 'rando.id',
      branch: undefined,
    })
  })
})

describe('runSetup — apps filter', () => {
  it('errors out if requested apps do not exist in config', async () => {
    const { emit } = captureEvents()
    await expect(
      runSetup(stubAll({}), { config, envs: ['dev'], apps: ['ghost'], emit }),
    ).rejects.toThrowError(/ghost/)
  })
})

describe('runDestroy', () => {
  it('refuses production with ProductionDestroyForbiddenError', async () => {
    const { emit } = captureEvents()
    await expect(
      runDestroy(stubAll({}), { config, env: 'production', apps: [], emit }),
    ).rejects.toBeInstanceOf(ProductionDestroyForbiddenError)
  })

  it('dev: removes per-app routes, then deletes the tunnel', async () => {
    const tunnel: TunnelProvider = {
      getTunnelByName: vi.fn(async () => ({ id: 't1', name: 'rando-dev' })),
      createTunnel: vi.fn(),
      listTunnels: vi.fn(),
      getTunnelToken: vi.fn(),
      addRoute: vi.fn(),
      listRoutes: vi.fn(async () => [
        { id: 'dev-api.rando-id.dev', hostname: 'dev-api.rando-id.dev', service: 'x' },
        { id: 'dev-web.rando-id.dev', hostname: 'dev-web.rando-id.dev', service: 'x' },
      ]),
      removeRoute: vi.fn(),
      deleteTunnel: vi.fn(),
    }
    const { events, emit } = captureEvents()
    await runDestroy(stubAll({ tunnel }), { config, env: 'dev', apps: [], emit })

    expect(tunnel.removeRoute).toHaveBeenCalledTimes(2)
    expect(tunnel.deleteTunnel).toHaveBeenCalledWith({ tunnelId: 't1' })
    expect(messages(events)).toContainEqual('step-done: tunnel "rando-dev" deleted (t1)')
  })

  it('dev: missing tunnel is a skip, not an error', async () => {
    const tunnel: TunnelProvider = {
      getTunnelByName: vi.fn(async () => null),
      createTunnel: vi.fn(),
      listTunnels: vi.fn(),
      getTunnelToken: vi.fn(),
      addRoute: vi.fn(),
      listRoutes: vi.fn(),
      removeRoute: vi.fn(),
      deleteTunnel: vi.fn(),
    }
    const { events, emit } = captureEvents()
    await runDestroy(stubAll({ tunnel }), { config, env: 'dev', apps: [], emit })
    expect(tunnel.deleteTunnel).not.toHaveBeenCalled()
    expect(messages(events)).toContainEqual('step-skip: tunnel "rando-dev" already absent')
  })

  it('staging: removes Vercel domains, DNS records, and the staging branch', async () => {
    const db: DbProvider = {
      createProject: vi.fn(),
      listProjects: vi.fn(async () => [{ id: 'p1', name: 'rando' }]),
      createBranch: vi.fn(),
      listBranches: vi.fn(async () => [
        { id: 'br_main', name: 'main', parentId: null, createdAt: 'x' },
        { id: 'br_staging', name: 'staging', parentId: 'br_main', createdAt: 'x' },
      ]),
      getConnectionString: vi.fn(),
      enableExtension: vi.fn(),
      deleteBranch: vi.fn(),
      deleteProject: vi.fn(),
      resetBranch: vi.fn(),
    }
    const deploy: DeployProvider = {
      createProject: vi.fn(),
      listProjects: vi.fn(),
      getProjectByName: vi.fn(async ({ name }) => ({ id: `p_${name}`, name, rootDirectory: null })),
      setEnv: vi.fn(),
      listEnv: vi.fn(),
      addDomain: vi.fn(),
      removeDomain: vi.fn(),
      deleteProject: vi.fn(),
      triggerDeployment: vi.fn(),
      getDeployment: vi.fn(),
    }
    const dns: DnsProvider = {
      addRecord: vi.fn(),
      listRecords: vi.fn(async () => [
        {
          id: 'rec_api',
          type: 'CNAME' as const,
          name: 'staging-api.rando-id.dev',
          content: 'cname.vercel-dns.com',
          ttl: 1,
          proxied: false,
        },
        {
          id: 'rec_web',
          type: 'CNAME' as const,
          name: 'staging-web.rando-id.dev',
          content: 'cname.vercel-dns.com',
          ttl: 1,
          proxied: false,
        },
      ]),
      removeRecord: vi.fn(),
    }
    const { events, emit } = captureEvents()
    await runDestroy(stubAll({ db, deploy, dns }), { config, env: 'staging', apps: [], emit })

    expect(deploy.removeDomain).toHaveBeenCalledWith({
      projectId: 'p_rando-api',
      hostname: 'staging-api.rando-id.dev',
    })
    expect(dns.removeRecord).toHaveBeenCalledWith({ zone: 'rando-id.dev', recordId: 'rec_api' })
    expect(db.deleteBranch).toHaveBeenCalledWith({ projectId: 'p1', branchId: 'br_staging' })
    expect(messages(events)).toContainEqual('step-done: db branch "staging" deleted (br_staging)')
  })

  it('staging: missing resources are skips, not errors', async () => {
    const db: DbProvider = {
      createProject: vi.fn(),
      listProjects: vi.fn(async () => []),
      createBranch: vi.fn(),
      listBranches: vi.fn(),
      getConnectionString: vi.fn(),
      enableExtension: vi.fn(),
      deleteBranch: vi.fn(),
      deleteProject: vi.fn(),
      resetBranch: vi.fn(),
    }
    const deploy: DeployProvider = {
      createProject: vi.fn(),
      listProjects: vi.fn(),
      getProjectByName: vi.fn(async () => null),
      setEnv: vi.fn(),
      listEnv: vi.fn(),
      addDomain: vi.fn(),
      removeDomain: vi.fn(),
      deleteProject: vi.fn(),
      triggerDeployment: vi.fn(),
      getDeployment: vi.fn(),
    }
    const dns: DnsProvider = {
      addRecord: vi.fn(),
      listRecords: vi.fn(async () => []),
      removeRecord: vi.fn(),
    }
    const { events, emit } = captureEvents()
    await runDestroy(stubAll({ db, deploy, dns }), { config, env: 'staging', apps: ['api'], emit })

    expect(deploy.removeDomain).not.toHaveBeenCalled()
    expect(dns.removeRecord).not.toHaveBeenCalled()
    expect(db.deleteBranch).not.toHaveBeenCalled()
    const msgs = messages(events)
    expect(msgs).toContainEqual('step-skip: vercel project "rando-api" already absent')
    expect(msgs).toContainEqual('step-skip: dns staging-api.rando-id.dev already absent')
    expect(msgs).toContainEqual('step-skip: db project "rando" already absent')
  })
})

// --- helpers --------------------------------------------------------------

type Partials = Partial<{
  db: DbProvider
  tunnel: TunnelProvider
  deploy: DeployProvider
  dns: DnsProvider
}>

function stubAll(overrides: Partials) {
  return {
    db: overrides.db ?? (notProvided('db') as DbProvider),
    tunnel: overrides.tunnel ?? (notProvided('tunnel') as TunnelProvider),
    deploy: overrides.deploy ?? (notProvided('deploy') as DeployProvider),
    dns: overrides.dns ?? (notProvided('dns') as DnsProvider),
  }
}

function notProvided(kind: string): unknown {
  // Return a proxy that throws if any method is called — surfaces test bugs.
  return new Proxy(
    {},
    {
      get() {
        return () => {
          throw new Error(`${kind} provider not stubbed in this test`)
        }
      },
    },
  )
}
