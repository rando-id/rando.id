import { describe, expect, it } from 'vitest'
import { VercelDeployProvider } from '../adapters/vercel'
import { ProviderApiError } from '../domain/errors'
import { stubFetch } from './helpers'

function adapter(stub: ReturnType<typeof stubFetch>, teamId?: string) {
  return new VercelDeployProvider({
    apiToken: 'vcl-token',
    teamId,
    baseUrl: 'https://vercel.test',
    fetch: stub.fetch,
  })
}

describe('VercelDeployProvider', () => {
  it('createProject posts framework + git repo', async () => {
    const stub = stubFetch([{ body: { id: 'p1', name: 'rando-api', rootDirectory: 'apps/api' } }])
    const result = await adapter(stub).createProject({
      name: 'rando-api',
      repo: 'me/rando',
      rootDirectory: 'apps/api',
    })
    expect(result).toEqual({ id: 'p1', name: 'rando-api', rootDirectory: 'apps/api' })
    expect(stub.calls[0]?.url).toBe('https://vercel.test/v11/projects')
    expect(stub.calls[0]?.body).toEqual({
      name: 'rando-api',
      framework: 'nextjs',
      gitRepository: { type: 'github', repo: 'me/rando' },
      rootDirectory: 'apps/api',
    })
  })

  it('appends teamId query when configured', async () => {
    const stub = stubFetch([{ body: { projects: [] } }])
    await adapter(stub, 'team_xyz').listProjects()
    expect(stub.calls[0]?.url).toContain('teamId=team_xyz')
  })

  it('getProjectByName returns null on 404', async () => {
    const stub = stubFetch([{ status: 404, body: { error: 'not found' } }])
    const result = await adapter(stub).getProjectByName({ name: 'missing' })
    expect(result).toBeNull()
  })

  it('getProjectByName rethrows non-404 errors', async () => {
    const stub = stubFetch([{ status: 500, body: { error: 'oops' } }])
    await expect(adapter(stub).getProjectByName({ name: 'x' })).rejects.toBeInstanceOf(
      ProviderApiError,
    )
  })

  it('setEnv passes upsert=true and scopes as target', async () => {
    const stub = stubFetch([{ body: { id: 'e1', key: 'DATABASE_URL', target: ['production'] } }])
    const result = await adapter(stub).setEnv({
      projectId: 'p1',
      key: 'DATABASE_URL',
      value: 'postgres://x',
      scopes: ['production'],
    })
    expect(result).toEqual({ id: 'e1', key: 'DATABASE_URL', scopes: ['production'] })
    expect(stub.calls[0]?.url).toContain('?upsert=true')
    expect(stub.calls[0]?.body).toEqual({
      key: 'DATABASE_URL',
      value: 'postgres://x',
      target: ['production'],
      type: 'encrypted',
    })
  })

  it('addDomain includes gitBranch when provided', async () => {
    const stub = stubFetch([{ body: { name: 'staging-web.rando-id.dev', gitBranch: 'staging' } }])
    const result = await adapter(stub).addDomain({
      projectId: 'p1',
      hostname: 'staging-web.rando-id.dev',
      branch: 'staging',
    })
    expect(result.branch).toBe('staging')
    expect(stub.calls[0]?.body).toEqual({
      name: 'staging-web.rando-id.dev',
      gitBranch: 'staging',
    })
  })

  it('addDomain omits gitBranch when not provided', async () => {
    const stub = stubFetch([{ body: { name: 'rando.id', gitBranch: null } }])
    const result = await adapter(stub).addDomain({
      projectId: 'p1',
      hostname: 'rando.id',
    })
    expect(result.branch).toBeNull()
    expect(stub.calls[0]?.body).toEqual({ name: 'rando.id' })
  })

  it('removeDomain DELETEs the encoded hostname', async () => {
    const stub = stubFetch([{ status: 200, body: {} }])
    await adapter(stub).removeDomain({ projectId: 'p1', hostname: 'rando.id' })
    expect(stub.calls[0]?.method).toBe('DELETE')
    expect(stub.calls[0]?.url).toBe('https://vercel.test/v9/projects/p1/domains/rando.id')
  })

  it('deleteProject DELETEs the project', async () => {
    const stub = stubFetch([{ status: 200, body: {} }])
    await adapter(stub).deleteProject({ projectId: 'p1' })
    expect(stub.calls[0]?.method).toBe('DELETE')
    expect(stub.calls[0]?.url).toBe('https://vercel.test/v9/projects/p1')
  })

  it('triggerDeployment looks up repoId, then POSTs to /v13/deployments', async () => {
    const stub = stubFetch([
      {
        body: {
          id: 'p1',
          name: 'rando-api',
          link: { type: 'github', repoId: 999, repo: 'me/rando', org: 'me' },
        },
      },
      {
        body: {
          id: 'dpl_abc',
          url: 'rando-api-git-feat-x.vercel.app',
          readyState: 'QUEUED',
        },
      },
    ])
    const result = await adapter(stub).triggerDeployment({ projectId: 'p1', branch: 'feat/x' })
    expect(result).toEqual({
      id: 'dpl_abc',
      url: 'rando-api-git-feat-x.vercel.app',
      branch: 'feat/x',
      state: 'queued',
    })
    expect(stub.calls[0]?.url).toContain('/v10/projects/p1')
    expect(stub.calls[1]?.url).toContain('/v13/deployments')
    expect(stub.calls[1]?.method).toBe('POST')
    expect(stub.calls[1]?.body).toEqual({
      name: 'rando-api',
      target: 'preview',
      gitSource: { type: 'github', ref: 'feat/x', repoId: 999 },
    })
  })

  it('triggerDeployment refuses when project has no linked GitHub repo', async () => {
    const stub = stubFetch([{ body: { id: 'p1', name: 'rando-api', link: null } }])
    await expect(
      adapter(stub).triggerDeployment({ projectId: 'p1', branch: 'main' }),
    ).rejects.toBeInstanceOf(ProviderApiError)
    // Only one call — the second (POST) should never have happened.
    expect(stub.calls).toHaveLength(1)
  })

  it('getDeployment normalizes Vercel readyState values', async () => {
    const stub = stubFetch([
      {
        body: {
          id: 'dpl_abc',
          url: 'foo.vercel.app',
          readyState: 'READY',
          meta: { githubCommitRef: 'feat/x' },
        },
      },
    ])
    const result = await adapter(stub).getDeployment({ deploymentId: 'dpl_abc' })
    expect(result).toEqual({
      id: 'dpl_abc',
      url: 'foo.vercel.app',
      branch: 'feat/x',
      state: 'ready',
    })
    expect(stub.calls[0]?.url).toBe('https://vercel.test/v13/deployments/dpl_abc')
  })
})
