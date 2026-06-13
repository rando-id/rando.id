import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run } from '../cli'
import type { Adapters } from '../config'
import type { DeployProvider } from '../domain/deploy'
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

function adaptersWithDeploy(deploy: DeployProvider): Adapters {
  const never = () => {
    throw new Error('not expected to be called')
  }
  return {
    db: never as never,
    tunnel: never as never,
    dns: never as never,
    deploy: () => deploy,
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
