import { describe, expect, it } from 'vitest'
import { CloudflareDnsProvider } from '../adapters/cloudflare-dns'
import { NotFoundError } from '../domain/errors'
import { stubFetch } from './helpers'

function adapter(stub: ReturnType<typeof stubFetch>) {
  return new CloudflareDnsProvider({
    apiToken: 'cf-token',
    baseUrl: 'https://cf.test/client/v4',
    fetch: stub.fetch,
  })
}

const cfOk = (result: unknown, status = 200) => ({
  status,
  body: { success: true, errors: [], result },
})

describe('CloudflareDnsProvider', () => {
  it('addRecord resolves zone by name then posts', async () => {
    const stub = stubFetch([
      cfOk([{ id: 'zone-1', name: 'rando-id.dev' }]),
      cfOk({
        id: 'rec-1',
        type: 'CNAME',
        name: 'staging-api',
        content: 'cname.vercel-dns.com',
        ttl: 1,
        proxied: false,
      }),
    ])
    const result = await adapter(stub).addRecord({
      zone: 'rando-id.dev',
      type: 'CNAME',
      name: 'staging-api',
      content: 'cname.vercel-dns.com',
    })
    expect(result.id).toBe('rec-1')
    expect(stub.calls[0]?.url).toContain('/zones?name=rando-id.dev')
    expect(stub.calls[1]?.url).toBe('https://cf.test/client/v4/zones/zone-1/dns_records')
    expect(stub.calls[1]?.body).toEqual({
      type: 'CNAME',
      name: 'staging-api',
      content: 'cname.vercel-dns.com',
      ttl: 1,
      proxied: false,
    })
  })

  it('listRecords returns normalized records', async () => {
    const stub = stubFetch([
      cfOk([{ id: 'zone-1', name: 'rando-id.dev' }]),
      cfOk([
        {
          id: 'r1',
          type: 'A',
          name: 'foo',
          content: '1.2.3.4',
          ttl: 300,
          proxied: true,
        },
      ]),
    ])
    const result = await adapter(stub).listRecords({ zone: 'rando-id.dev' })
    expect(result).toEqual([
      { id: 'r1', type: 'A', name: 'foo', content: '1.2.3.4', ttl: 300, proxied: true },
    ])
  })

  it('throws NotFoundError when zone does not exist', async () => {
    const stub = stubFetch([cfOk([])])
    await expect(adapter(stub).listRecords({ zone: 'absent.example' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('removeRecord issues DELETE against the resolved zone', async () => {
    const stub = stubFetch([cfOk([{ id: 'zone-1', name: 'rando-id.dev' }]), cfOk({})])
    await adapter(stub).removeRecord({ zone: 'rando-id.dev', recordId: 'rec-1' })
    expect(stub.calls[1]?.method).toBe('DELETE')
    expect(stub.calls[1]?.url).toBe('https://cf.test/client/v4/zones/zone-1/dns_records/rec-1')
  })
})
