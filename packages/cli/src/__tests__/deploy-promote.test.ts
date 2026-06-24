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
  const dir = mkdtempSync(join(tmpdir(), 'rando-deploy-promote-'))
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
    tracker: never as never,
    apiTesting: never as never,
    postman: never as never,
    secrets: never as never,
    gh: never as never,
    vercelCli: never as never,
  }
}

describe('deploy promote', () => {
  it('staging defaults to branch=staging + passes target=staging', async () => {
    const triggerDeployment = vi.fn(async (_input: { projectId: string; branch: string }) => ({
      id: `dpl_${_input.projectId}`,
      url: `${_input.projectId}.vercel.app`,
      branch: _input.branch,
      state: 'queued' as const,
    }))
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async ({ name }) => ({ id: `p_${name}`, name, rootDirectory: null })),
      triggerDeployment,
      getDeployment: vi.fn(() => {
        throw new Error('getDeployment must NOT be called with --no-wait')
      }),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['deploy', 'promote', 'staging', '--config', path, '--no-wait'], {
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
      branch: 'staging',
      target: 'staging',
    })
    expect(triggerDeployment).toHaveBeenCalledWith({
      projectId: 'p_rando-web',
      branch: 'staging',
      target: 'staging',
    })
  })

  it('production defaults to branch=main + passes target=production', async () => {
    const triggerDeployment = vi.fn(async (input: { projectId: string; branch: string }) => ({
      id: `dpl_${input.projectId}`,
      url: `${input.projectId}.vercel.app`,
      branch: input.branch,
      state: 'queued' as const,
    }))
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async ({ name }) => ({ id: `p_${name}`, name, rootDirectory: null })),
      triggerDeployment,
      getDeployment: vi.fn(),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(
        ['deploy', 'promote', 'production', '--config', path, '--apps', 'api', '--no-wait'],
        {
          adapters: adaptersWithDeploy(deploy as DeployProvider),
          io: io.io,
          exit: () => {
            throw new Error('unexpected exit')
          },
        },
      )
    } finally {
      cwdSpy.mockRestore()
    }
    expect(triggerDeployment).toHaveBeenCalledWith({
      projectId: 'p_rando-api',
      branch: 'main',
      target: 'production',
    })
  })

  it('--ref overrides the default branch', async () => {
    const triggerDeployment = vi.fn(async (input: { projectId: string; branch: string }) => ({
      id: 'd',
      url: 'u',
      branch: input.branch,
      state: 'queued' as const,
    }))
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async ({ name }) => ({ id: `p_${name}`, name, rootDirectory: null })),
      triggerDeployment,
      getDeployment: vi.fn(),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(
        [
          'deploy',
          'promote',
          'production',
          '--config',
          path,
          '--apps',
          'api',
          '--ref',
          'abc123',
          '--no-wait',
        ],
        {
          adapters: adaptersWithDeploy(deploy as DeployProvider),
          io: io.io,
          exit: () => {
            throw new Error('unexpected exit')
          },
        },
      )
    } finally {
      cwdSpy.mockRestore()
    }
    expect(triggerDeployment).toHaveBeenCalledWith({
      projectId: 'p_rando-api',
      branch: 'abc123',
      target: 'production',
    })
  })

  it('rejects unknown target with a clear error', async () => {
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(),
      triggerDeployment: vi.fn(),
      getDeployment: vi.fn(),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const exit = vi.fn() as unknown as (code: number) => never
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['deploy', 'promote', 'dev', '--config', path, '--no-wait'], {
        adapters: adaptersWithDeploy(deploy as DeployProvider),
        io: io.io,
        exit,
      })
    } finally {
      cwdSpy.mockRestore()
    }
    expect(exit).toHaveBeenCalledWith(1)
    expect(io.stderr.join('\n')).toMatch(/Unknown deploy target "dev"/)
    expect(deploy.triggerDeployment).not.toHaveBeenCalled()
  })

  it('polls until ready when --no-wait is not set', async () => {
    const deploy: Partial<DeployProvider> = {
      getProjectByName: vi.fn(async ({ name }) => ({ id: `p_${name}`, name, rootDirectory: null })),
      triggerDeployment: vi.fn(async (input) => ({
        id: `dpl_${input.projectId}`,
        url: `${input.projectId}.vercel.app`,
        branch: input.branch,
        state: 'queued' as const,
      })),
      getDeployment: vi.fn(async ({ deploymentId }) => ({
        id: deploymentId,
        url: `${deploymentId.replace('dpl_', '')}.vercel.app`,
        branch: 'staging',
        state: 'ready' as const,
      })),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['deploy', 'promote', 'staging', '--config', path, '--apps', 'api'], {
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
    expect(io.stdout.join('\n')).toContain('https://p_rando-api.vercel.app')
  })
})
