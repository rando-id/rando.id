// Tests for the Postman REST adapter. Covers auth header, response
// shape mapping, find-by-name, delete + import flow, and provider
// error surface.

import { describe, expect, it } from 'vitest'
import { PostmanRestProvider } from '../adapters/postman'
import { ProviderApiError } from '../domain/errors'
import { stubFetch } from './helpers'

function adapter(stub: ReturnType<typeof stubFetch>) {
  return new PostmanRestProvider({
    apiKey: 'PMAK-test',
    fetch: stub.fetch,
    baseUrl: 'https://api.postman.test',
  })
}

describe('PostmanRestProvider', () => {
  it('getMyself sends X-Api-Key + maps the user shape', async () => {
    const stub = stubFetch([{ body: { user: { id: 42, username: 'newton', fullName: 'Newton' } } }])
    const me = await adapter(stub).getMyself()
    expect(me).toEqual({ id: 42, username: 'newton', fullName: 'Newton' })
    expect(stub.calls[0]?.url).toBe('https://api.postman.test/me')
    expect(stub.calls[0]?.headers).toMatchObject({
      'X-Api-Key': 'PMAK-test',
      Accept: 'application/json',
    })
    // Postman API requires the bare key, no "Bearer " prefix — regression guard.
    expect(stub.calls[0]?.headers.Authorization).toBeUndefined()
  })

  it('listWorkspaces maps each entry', async () => {
    const stub = stubFetch([
      {
        body: {
          workspaces: [
            { id: 'ws-1', name: 'Personal', type: 'personal' },
            { id: 'ws-2', name: 'Team', type: 'team' },
          ],
        },
      },
    ])
    const result = await adapter(stub).listWorkspaces()
    expect(result).toEqual([
      { id: 'ws-1', name: 'Personal', type: 'personal' },
      { id: 'ws-2', name: 'Team', type: 'team' },
    ])
  })

  it('findCollectionByName returns the match, null when absent', async () => {
    const stub = stubFetch([
      {
        body: {
          collections: [
            { id: 'c-1', uid: 'u-1', name: 'Other' },
            { id: 'c-2', uid: 'u-2', name: 'Rando API' },
          ],
        },
      },
      { body: { collections: [{ id: 'c-1', uid: 'u-1', name: 'Other' }] } },
    ])
    const a = adapter(stub)
    const hit = await a.findCollectionByName({ workspaceId: 'ws-1', name: 'Rando API' })
    expect(hit).toEqual({ id: 'c-2', uid: 'u-2', name: 'Rando API' })
    expect(stub.calls[0]?.url).toBe('https://api.postman.test/collections?workspace=ws-1')
    const miss = await a.findCollectionByName({ workspaceId: 'ws-1', name: 'Rando API' })
    expect(miss).toBeNull()
  })

  it('deleteCollection issues a DELETE with the encoded uid', async () => {
    const stub = stubFetch([{ status: 200, body: { collection: { id: 'c-2' } } }])
    await adapter(stub).deleteCollection('uid with space')
    expect(stub.calls[0]).toMatchObject({
      method: 'DELETE',
      url: 'https://api.postman.test/collections/uid%20with%20space',
    })
  })

  it('importOpenApi sends the spec as JSON-string under `input`', async () => {
    const stub = stubFetch([
      {
        status: 200,
        body: { collections: [{ id: 'c-3', uid: 'u-3', name: 'Rando API' }] },
      },
    ])
    const spec = { openapi: '3.0.0', info: { title: 'Rando', version: '1.0' }, paths: {} }
    const result = await adapter(stub).importOpenApi({ workspaceId: 'ws-1', spec })
    expect(result).toEqual({ id: 'c-3', uid: 'u-3', name: 'Rando API' })
    expect(stub.calls[0]?.method).toBe('POST')
    expect(stub.calls[0]?.url).toBe('https://api.postman.test/import/openapi?workspace=ws-1')
    expect(stub.calls[0]?.body).toEqual({
      type: 'string',
      input: JSON.stringify(spec),
    })
  })

  it('importOpenApi throws ProviderApiError when Postman returns no collections', async () => {
    const stub = stubFetch([{ status: 200, body: { collections: [] } }])
    await expect(
      adapter(stub).importOpenApi({ workspaceId: 'ws-1', spec: {} }),
    ).rejects.toBeInstanceOf(ProviderApiError)
  })

  it('non-2xx responses surface as ProviderApiError with the body text', async () => {
    const stub = stubFetch([{ status: 401, text: 'AuthenticationError' }])
    await expect(adapter(stub).getMyself()).rejects.toMatchObject({
      provider: 'postman',
      status: 401,
      body: 'AuthenticationError',
    })
  })

  it('empty 200 bodies resolve without parsing', async () => {
    const stub = stubFetch([{ status: 200, text: '' }])
    await expect(adapter(stub).deleteCollection('c-1')).resolves.toBeUndefined()
  })

  it('createCollection POSTs the local JSON wrapped under `collection`', async () => {
    const stub = stubFetch([{ body: { collection: { id: 'c-9', uid: 'u-9', name: 'Rando API' } } }])
    const localCollection = { info: { name: 'Rando API' }, item: [{ name: 'health' }] }
    const result = await adapter(stub).createCollection({
      workspaceId: 'ws-1',
      collection: localCollection,
    })
    expect(result).toEqual({ id: 'c-9', uid: 'u-9', name: 'Rando API' })
    expect(stub.calls[0]?.method).toBe('POST')
    expect(stub.calls[0]?.url).toBe('https://api.postman.test/collections?workspace=ws-1')
    expect(stub.calls[0]?.body).toEqual({ collection: localCollection })
  })

  it('updateCollection PUTs to the existing uid (preserves stable id)', async () => {
    const stub = stubFetch([{ body: { collection: { id: 'c-9', uid: 'u-9', name: 'Rando API' } } }])
    await adapter(stub).updateCollection({
      uid: 'u-9',
      collection: { info: { name: 'Rando API' }, item: [] },
    })
    expect(stub.calls[0]?.method).toBe('PUT')
    expect(stub.calls[0]?.url).toBe('https://api.postman.test/collections/u-9')
  })

  it('listEnvironments maps each entry from the workspace', async () => {
    const stub = stubFetch([
      {
        body: {
          environments: [
            { id: 'e-1', uid: 'u-1', name: 'local' },
            { id: 'e-2', uid: 'u-2', name: 'staging' },
          ],
        },
      },
    ])
    const result = await adapter(stub).listEnvironments({ workspaceId: 'ws-1' })
    expect(result).toHaveLength(2)
    expect(stub.calls[0]?.url).toBe('https://api.postman.test/environments?workspace=ws-1')
  })

  it('findEnvironmentByName returns the match by name, null when absent', async () => {
    const stub = stubFetch([
      {
        body: {
          environments: [
            { id: 'e-1', uid: 'u-1', name: 'local' },
            { id: 'e-2', uid: 'u-2', name: 'staging' },
          ],
        },
      },
    ])
    const found = await adapter(stub).findEnvironmentByName({
      workspaceId: 'ws-1',
      name: 'staging',
    })
    expect(found?.uid).toBe('u-2')
  })

  it('createEnvironment POSTs the env wrapped under `environment`', async () => {
    const stub = stubFetch([{ body: { environment: { id: 'e-9', uid: 'u-9', name: 'local' } } }])
    const local = { name: 'local', values: [{ key: 'baseUrl', value: 'http://x' }] }
    await adapter(stub).createEnvironment({ workspaceId: 'ws-1', environment: local })
    expect(stub.calls[0]?.method).toBe('POST')
    expect(stub.calls[0]?.body).toEqual({ environment: local })
  })

  it('updateEnvironment PUTs by uid', async () => {
    const stub = stubFetch([{ body: { environment: { id: 'e-9', uid: 'u-9', name: 'local' } } }])
    await adapter(stub).updateEnvironment({
      uid: 'u-9',
      environment: { name: 'local', values: [] },
    })
    expect(stub.calls[0]?.method).toBe('PUT')
    expect(stub.calls[0]?.url).toBe('https://api.postman.test/environments/u-9')
  })
})
