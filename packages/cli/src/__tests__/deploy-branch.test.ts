import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run } from '../cli'
import type { Adapters } from '../config'
import type { DeployProvider } from '../domain/deploy'
import type { DnsProvider } from '../domain/dns'
import { captureIo } from './helpers'

const tmpDirs: string[] = []
afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function writeConfig(): { path: string; cwd: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rando-deploy-branch-'))
  tmpDirs.push(dir)
  const path = join(dir, 'rando.config.json')
  writeFileSync(
    path,
    JSON.stringify({
      project: 'rando',
      repo: 'me/rando',
      domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
      apps: [
        { name: 'api', rootDirectory: 'apps/api', port: 4000 },
        { name: 'web', rootDirectory: 'apps/web', port: 3000 },
      ],
    }),
  )
  return { path, cwd: dir }
}

function adaptersWithDeploy(deploy: DeployProvider, dns?: DnsProvider): Adapters {
  const never = () => {
    throw new Error('not expected to be called')
  }
  return {
    db: never as never,
    tunnel: never as never,
    dns: dns ? () => dns : (never as never),
    deploy: () => deploy,
    tracker: never as never,
    postman: never as never,
    secrets: never as never,
    gh: never as never,
    vercelCli: never as never,
  }
}

describe('deploy branch', () => {
  it('--no-wait triggers all apps in parallel and exits without polling', async () => {
    const triggerDeployment = vi.fn(async ({ projectId, branch }) => ({
      id: `dpl_${projectId}`,
      url: `${projectId}-git-${branch.replace('/', '-')}.vercel.app`,
      branch,
      state: 'queued' as const,
    }))
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async ({ name }) => ({ id: `p_${name}`, name, rootDirectory: null })),
      triggerDeployment,
      getDeployment: vi.fn(() => {
        throw new Error('getDeployment must NOT be called when --no-wait is set')
      }),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['deploy', 'branch', 'feature/x', '--config', path, '--no-wait'], {
        adapters: adaptersWithDeploy(deploy as DeployProvider),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      cwdSpy.mockRestore()
    }
    expect(triggerDeployment).toHaveBeenCalledTimes(2)
    expect(triggerDeployment).toHaveBeenCalledWith({
      projectId: 'p_rando-api',
      branch: 'feature/x',
    })
    expect(triggerDeployment).toHaveBeenCalledWith({
      projectId: 'p_rando-web',
      branch: 'feature/x',
    })
    const text = io.stdout.join('\n')
    expect(text).toContain('https://p_rando-api-git-feature-x.vercel.app')
    expect(text).toContain('https://p_rando-web-git-feature-x.vercel.app')
  })

  it('polls until each deployment is ready, then prints URLs', async () => {
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async ({ name }) => ({ id: `p_${name}`, name, rootDirectory: null })),
      triggerDeployment: vi.fn(async ({ projectId, branch }) => ({
        id: `dpl_${projectId}`,
        url: `${projectId}.vercel.app`,
        branch,
        state: 'queued' as const,
      })),
      getDeployment: vi.fn(async ({ deploymentId }) => ({
        id: deploymentId,
        url: `${deploymentId.replace('dpl_', '')}.vercel.app`,
        branch: 'main',
        state: 'ready' as const,
      })),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['deploy', 'branch', 'main', '--config', path, '--apps', 'api'], {
        adapters: adaptersWithDeploy(deploy as DeployProvider),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      cwdSpy.mockRestore()
    }
    expect(deploy.getDeployment).toHaveBeenCalledWith({ deploymentId: 'dpl_p_rando-api' })
    // Spinner sequence: one for triggering, one for building, both succeed.
    expect(io.spinners.length).toBeGreaterThanOrEqual(2)
    expect(io.spinners.some((s) => s.events.some((e) => e.type === 'succeed'))).toBe(true)
    expect(io.stdout.join('\n')).toContain('https://p_rando-api.vercel.app')
  })

  it('--stable-url adds a Vercel domain + Cloudflare CNAME per app', async () => {
    const project = (name: string) => ({ id: `p_${name}`, name, rootDirectory: null })
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async ({ name }) => project(name)),
      triggerDeployment: vi.fn(async ({ projectId, branch }) => ({
        id: `dpl_${projectId}`,
        url: `${projectId}.vercel.app`,
        branch,
        state: 'queued' as const,
      })),
      getDeployment: vi.fn(async ({ deploymentId }) => ({
        id: deploymentId,
        url: 'foo.vercel.app',
        branch: 'feat/x',
        state: 'ready' as const,
      })),
      addDomain: vi.fn(async ({ hostname }) => ({ name: hostname, branch: null })),
    }
    const dns: Partial<DnsProvider> = {
      listRecords: vi.fn(async () => []),
      addRecord: vi.fn(async () => ({
        id: 'rec_1',
        type: 'CNAME' as const,
        name: 'x',
        content: 'cname.vercel-dns.com',
        ttl: 1,
        proxied: false,
      })),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['deploy', 'branch', 'feat/x', '--config', path, '--apps', 'api', '--stable-url'], {
        adapters: adaptersWithDeploy(deploy as DeployProvider, dns as DnsProvider),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      cwdSpy.mockRestore()
    }
    // Slugified branch: feat/x → feat-x → hostname `feat-x-api.rando-id.dev`
    expect(deploy.addDomain).toHaveBeenCalledWith({
      projectId: 'p_rando-api',
      hostname: 'feat-x-api.rando-id.dev',
      branch: 'feat/x',
    })
    expect(dns.addRecord).toHaveBeenCalledWith({
      zone: 'rando-id.dev',
      type: 'CNAME',
      name: 'feat-x-api',
      content: 'cname.vercel-dns.com',
    })
    expect(io.stdout.join('\n')).toContain('feat-x-api.rando-id.dev')
  })

  it('--stable-url skips DNS when the record already exists', async () => {
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async ({ name }) => ({
        id: `p_${name}`,
        name,
        rootDirectory: null,
      })),
      triggerDeployment: vi.fn(async ({ projectId, branch }) => ({
        id: `dpl_${projectId}`,
        url: 'x.vercel.app',
        branch,
        state: 'queued' as const,
      })),
      getDeployment: vi.fn(async ({ deploymentId }) => ({
        id: deploymentId,
        url: 'x.vercel.app',
        branch: 'main',
        state: 'ready' as const,
      })),
      addDomain: vi.fn(async () => ({ name: 'main-api.rando-id.dev', branch: 'main' })),
    }
    const dns: Partial<DnsProvider> = {
      listRecords: vi.fn(async () => [
        {
          id: 'rec_existing',
          type: 'CNAME' as const,
          name: 'main-api.rando-id.dev',
          content: 'cname.vercel-dns.com',
          ttl: 1,
          proxied: false,
        },
      ]),
      addRecord: vi.fn(),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['deploy', 'branch', 'main', '--config', path, '--apps', 'api', '--stable-url'], {
        adapters: adaptersWithDeploy(deploy as DeployProvider, dns as DnsProvider),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      cwdSpy.mockRestore()
    }
    expect(dns.addRecord).not.toHaveBeenCalled()
  })

  it('teardown removes Vercel domain + Cloudflare CNAME for each app', async () => {
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async ({ name }) => ({ id: `p_${name}`, name, rootDirectory: null })),
      removeDomain: vi.fn(async () => {}),
    }
    const dns: Partial<DnsProvider> = {
      listRecords: vi.fn(async () => [
        {
          id: 'rec_api',
          type: 'CNAME' as const,
          name: 'feat-x-api.rando-id.dev',
          content: 'cname.vercel-dns.com',
          ttl: 1,
          proxied: false,
        },
      ]),
      removeRecord: vi.fn(async () => {}),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['deploy', 'teardown', 'feat/x', '--config', path, '--apps', 'api', '--yes'], {
        adapters: adaptersWithDeploy(deploy as DeployProvider, dns as DnsProvider),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      cwdSpy.mockRestore()
    }
    expect(deploy.removeDomain).toHaveBeenCalledWith({
      projectId: 'p_rando-api',
      hostname: 'feat-x-api.rando-id.dev',
    })
    expect(dns.removeRecord).toHaveBeenCalledWith({
      zone: 'rando-id.dev',
      recordId: 'rec_api',
    })
  })

  it('teardown is idempotent — skips when DNS record is already absent', async () => {
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async ({ name }) => ({ id: `p_${name}`, name, rootDirectory: null })),
      removeDomain: vi.fn(async () => {
        throw Object.assign(new Error('not found'), { status: 404 })
      }),
    }
    const dns: Partial<DnsProvider> = {
      listRecords: vi.fn(async () => []),
      removeRecord: vi.fn(),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['deploy', 'teardown', 'gone', '--config', path, '--apps', 'api', '--yes'], {
        adapters: adaptersWithDeploy(deploy as DeployProvider, dns as DnsProvider),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      cwdSpy.mockRestore()
    }
    // removeDomain was called and threw 404 — that's fine, treated as already gone.
    expect(deploy.removeDomain).toHaveBeenCalled()
    // No DNS record matched, so removeRecord never fired.
    expect(dns.removeRecord).not.toHaveBeenCalled()
  })

  it('errors when --apps names something that is not in the config', async () => {
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const exit = vi.fn() as unknown as (code: number) => never
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['deploy', 'branch', 'main', '--config', path, '--apps', 'ghost'], {
        adapters: adaptersWithDeploy({} as DeployProvider),
        io: io.io,
        exit,
      })
    } finally {
      cwdSpy.mockRestore()
    }
    expect(exit).toHaveBeenCalledWith(1)
    expect(io.stderr.join('\n')).toMatch(/No matching apps/)
  })
})
