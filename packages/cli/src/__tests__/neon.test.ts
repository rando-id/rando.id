import { describe, expect, it } from 'vitest'
import { NeonDbProvider } from '../adapters/neon'
import { ProviderApiError } from '../domain/errors'
import { stubFetch } from './helpers'

function adapter(stub: ReturnType<typeof stubFetch>) {
  return new NeonDbProvider({
    apiKey: 'token-abc',
    baseUrl: 'https://neon.test/api/v2',
    fetch: stub.fetch,
  })
}

describe('NeonDbProvider', () => {
  it('createProject posts to /projects and normalizes the response', async () => {
    const stub = stubFetch([{ status: 201, body: { project: { id: 'proj_1', name: 'rando' } } }])
    const provider = adapter(stub)
    const result = await provider.createProject({ name: 'rando' })
    expect(result).toEqual({ id: 'proj_1', name: 'rando' })
    expect(stub.calls[0]?.url).toBe('https://neon.test/api/v2/projects')
    expect(stub.calls[0]?.method).toBe('POST')
    expect(stub.calls[0]?.headers).toMatchObject({
      Authorization: 'Bearer token-abc',
      'Content-Type': 'application/json',
    })
    expect(stub.calls[0]?.body).toEqual({
      project: { name: 'rando', region_id: 'aws-us-east-2', pg_version: 16 },
    })
  })

  it('listProjects maps the response array', async () => {
    const stub = stubFetch([
      {
        body: {
          projects: [
            { id: 'p1', name: 'one' },
            { id: 'p2', name: 'two' },
          ],
        },
      },
    ])
    const provider = adapter(stub)
    const result = await provider.listProjects()
    expect(result).toEqual([
      { id: 'p1', name: 'one' },
      { id: 'p2', name: 'two' },
    ])
  })

  it('createBranch includes parent_id when fromBranchId given', async () => {
    const stub = stubFetch([
      {
        body: {
          branch: {
            id: 'br_2',
            name: 'staging',
            parent_id: 'br_1',
            created_at: '2026-06-11T00:00:00Z',
          },
        },
      },
    ])
    const provider = adapter(stub)
    const result = await provider.createBranch({
      projectId: 'proj_1',
      name: 'staging',
      fromBranchId: 'br_1',
    })
    expect(result.parentId).toBe('br_1')
    expect(stub.calls[0]?.body).toEqual({
      branch: { name: 'staging', parent_id: 'br_1' },
      endpoints: [{ type: 'read_write' }],
    })
  })

  it('getConnectionString discovers the default db first, then asks for URI', async () => {
    const stub = stubFetch([
      {
        body: {
          databases: [{ id: 1, name: 'neondb', owner_name: 'rando' }],
        },
      },
      { body: { uri: 'postgres://example' } },
    ])
    const provider = adapter(stub)
    const result = await provider.getConnectionString({
      projectId: 'proj_1',
      branchId: 'br_1',
      pooled: true,
    })
    expect(result.url).toBe('postgres://example')
    expect(stub.calls[1]?.url).toContain('pooled=true')
    expect(stub.calls[1]?.url).toContain('database_name=neondb')
    expect(stub.calls[1]?.url).toContain('role_name=rando')
  })

  it('enableExtension runs the right SQL via run_sql', async () => {
    const stub = stubFetch([
      {
        body: {
          databases: [{ id: 1, name: 'neondb', owner_name: 'rando' }],
        },
      },
      { status: 200, body: {} },
    ])
    const provider = adapter(stub)
    await provider.enableExtension({
      projectId: 'proj_1',
      branchId: 'br_1',
      extension: 'postgis',
    })
    expect(stub.calls[1]?.body).toEqual({
      query: 'CREATE EXTENSION IF NOT EXISTS "postgis"',
    })
  })

  it('throws ProviderApiError on non-success', async () => {
    const stub = stubFetch([{ status: 403, text: 'forbidden' }])
    const provider = adapter(stub)
    await expect(provider.listProjects()).rejects.toBeInstanceOf(ProviderApiError)
  })

  it('deleteBranch DELETEs the branch under the project', async () => {
    const stub = stubFetch([{ status: 200, body: {} }])
    await adapter(stub).deleteBranch({ projectId: 'p1', branchId: 'br_x' })
    expect(stub.calls[0]?.method).toBe('DELETE')
    expect(stub.calls[0]?.url).toBe('https://neon.test/api/v2/projects/p1/branches/br_x')
  })

  it('deleteProject DELETEs the project', async () => {
    const stub = stubFetch([{ status: 200, body: {} }])
    await adapter(stub).deleteProject({ projectId: 'p1' })
    expect(stub.calls[0]?.method).toBe('DELETE')
    expect(stub.calls[0]?.url).toBe('https://neon.test/api/v2/projects/p1')
  })

  it('resetBranch POSTs to /restore with source_branch_id', async () => {
    const stub = stubFetch([{ status: 200, body: {} }])
    await adapter(stub).resetBranch({
      projectId: 'p1',
      branchId: 'br_staging',
      sourceBranchId: 'br_main',
    })
    expect(stub.calls[0]?.method).toBe('POST')
    expect(stub.calls[0]?.url).toBe(
      'https://neon.test/api/v2/projects/p1/branches/br_staging/restore',
    )
    expect(stub.calls[0]?.body).toEqual({ source_branch_id: 'br_main' })
  })
})
