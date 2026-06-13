import { describe, expect, it } from 'vitest'
import { CloudflareTunnelProvider } from '../adapters/cloudflare-tunnel'
import { NotFoundError } from '../domain/errors'
import { stubFetch } from './helpers'

function adapter(stub: ReturnType<typeof stubFetch>) {
  return new CloudflareTunnelProvider({
    apiToken: 'cf-token',
    accountId: 'acc-1',
    baseUrl: 'https://cf.test/client/v4',
    fetch: stub.fetch,
  })
}

const cfOk = (result: unknown, status = 200) => ({
  status,
  body: { success: true, errors: [], result },
})

describe('CloudflareTunnelProvider', () => {
  it('createTunnel posts with config_src=cloudflare', async () => {
    const stub = stubFetch([cfOk({ id: 't1', name: 'rando-dev' }, 201)])
    const result = await adapter(stub).createTunnel({ name: 'rando-dev' })
    expect(result).toEqual({ id: 't1', name: 'rando-dev' })
    expect(stub.calls[0]?.url).toBe('https://cf.test/client/v4/accounts/acc-1/cfd_tunnel')
    expect(stub.calls[0]?.body).toEqual({
      name: 'rando-dev',
      config_src: 'cloudflare',
    })
  })

  it('listTunnels returns normalized tunnels', async () => {
    const stub = stubFetch([
      cfOk([
        { id: 't1', name: 'one' },
        { id: 't2', name: 'two' },
      ]),
    ])
    const result = await adapter(stub).listTunnels()
    expect(result).toEqual([
      { id: 't1', name: 'one' },
      { id: 't2', name: 'two' },
    ])
  })

  it('getTunnelByName returns null when not found', async () => {
    const stub = stubFetch([cfOk([{ id: 't1', name: 'other' }])])
    const result = await adapter(stub).getTunnelByName({ name: 'missing' })
    expect(result).toBeNull()
  })

  it('addRoute appends to existing ingress and re-applies catch-all', async () => {
    const stub = stubFetch([
      // initial GET configurations
      cfOk({
        config: {
          ingress: [
            { hostname: 'dev-web.rando-id.dev', service: 'http://host.docker.internal:3000' },
            { service: 'http_status:404' },
          ],
        },
      }),
      // PUT
      cfOk({}),
    ])
    const provider = adapter(stub)
    const result = await provider.addRoute({
      tunnelId: 't1',
      hostname: 'dev-api.rando-id.dev',
      service: 'http://host.docker.internal:4000',
    })
    expect(result.hostname).toBe('dev-api.rando-id.dev')
    expect(stub.calls[1]?.method).toBe('PUT')
    const putBody = stub.calls[1]?.body as { config: { ingress: unknown[] } }
    // Should include both the original route + the new one + a catch-all.
    expect(putBody.config.ingress).toEqual([
      { hostname: 'dev-web.rando-id.dev', service: 'http://host.docker.internal:3000' },
      { hostname: 'dev-api.rando-id.dev', service: 'http://host.docker.internal:4000' },
      { service: 'http_status:404' },
    ])
  })

  it('addRoute replaces an existing hostname rather than duplicating it', async () => {
    const stub = stubFetch([
      cfOk({
        config: {
          ingress: [
            { hostname: 'dev-api.rando-id.dev', service: 'http://host.docker.internal:9999' },
            { service: 'http_status:404' },
          ],
        },
      }),
      cfOk({}),
    ])
    await adapter(stub).addRoute({
      tunnelId: 't1',
      hostname: 'dev-api.rando-id.dev',
      service: 'http://host.docker.internal:4000',
    })
    const putBody = stub.calls[1]?.body as { config: { ingress: unknown[] } }
    expect(putBody.config.ingress).toEqual([
      { hostname: 'dev-api.rando-id.dev', service: 'http://host.docker.internal:4000' },
      { service: 'http_status:404' },
    ])
  })

  it('listRoutes strips the catch-all', async () => {
    const stub = stubFetch([
      cfOk({
        config: {
          ingress: [
            { hostname: 'dev-api.rando-id.dev', service: 'http://host.docker.internal:4000' },
            { service: 'http_status:404' },
          ],
        },
      }),
    ])
    const result = await adapter(stub).listRoutes({ tunnelId: 't1' })
    expect(result).toEqual([
      {
        id: 'dev-api.rando-id.dev',
        hostname: 'dev-api.rando-id.dev',
        service: 'http://host.docker.internal:4000',
      },
    ])
  })

  it('removeRoute throws NotFoundError when hostname is absent', async () => {
    const stub = stubFetch([
      cfOk({
        config: {
          ingress: [
            { hostname: 'dev-web.rando-id.dev', service: 'http://host.docker.internal:3000' },
            { service: 'http_status:404' },
          ],
        },
      }),
    ])
    await expect(
      adapter(stub).removeRoute({ tunnelId: 't1', routeId: 'nope.rando-id.dev' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
