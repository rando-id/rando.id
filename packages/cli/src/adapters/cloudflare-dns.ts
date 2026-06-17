// Cloudflare DNS implementation of DnsProvider.
// API reference: https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-list-dns-records

import { NotFoundError, ProviderApiError } from '../domain/errors'
import type { DnsProvider, DnsRecord, DnsRecordType } from '../domain/dns'

const BASE_URL = 'https://api.cloudflare.com/client/v4'

export interface CloudflareDnsProviderOptions {
  apiToken: string
  /** Override for tests. Defaults to global fetch. */
  fetch?: typeof fetch
  /** Override base URL for tests. */
  baseUrl?: string
}

export class CloudflareDnsProvider implements DnsProvider {
  private readonly fetch: typeof fetch
  private readonly baseUrl: string

  constructor(private readonly options: CloudflareDnsProviderOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.baseUrl = options.baseUrl ?? BASE_URL
  }

  async addRecord(input: {
    zone: string
    type: DnsRecordType
    name: string
    content: string
    ttl?: number
    proxied?: boolean
  }): Promise<DnsRecord> {
    const zoneId = await this.resolveZoneId(input.zone)
    const result = await this.request<CfDnsRecordShape>('POST', `/zones/${zoneId}/dns_records`, {
      type: input.type,
      name: input.name,
      content: input.content,
      ttl: input.ttl ?? 1, // 1 = "auto"
      proxied: input.proxied ?? false,
    })
    return mapRecord(result)
  }

  async listRecords(input: { zone: string }): Promise<DnsRecord[]> {
    const zoneId = await this.resolveZoneId(input.zone)
    const result = await this.request<CfDnsRecordShape[]>(
      'GET',
      `/zones/${zoneId}/dns_records?per_page=100`,
    )
    return result.map(mapRecord)
  }

  async removeRecord(input: { zone: string; recordId: string }): Promise<void> {
    const zoneId = await this.resolveZoneId(input.zone)
    await this.request('DELETE', `/zones/${zoneId}/dns_records/${input.recordId}`)
  }

  private async resolveZoneId(zoneName: string): Promise<string> {
    const zones = await this.request<CfZoneShape[]>(
      'GET',
      `/zones?name=${encodeURIComponent(zoneName)}`,
    )
    const match = zones[0]
    if (!match) throw new NotFoundError('zone', zoneName)
    return match.id
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const fullUrl = `${this.baseUrl}${path}`
    let response: Response
    try {
      response = await this.fetch(fullUrl, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (e) {
      // Transport-level failure (DNS, TCP, TLS) — wrap so orchestrator
      // callers see which API call broke instead of a bare `fetch failed`.
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      throw new ProviderApiError('cloudflare', 0, `fetch ${method} ${fullUrl} failed: ${detail}`)
    }
    const text = await response.text()
    if (!response.ok) throw new ProviderApiError('cloudflare', response.status, text)
    if (!text) return undefined as T
    const parsed = JSON.parse(text) as CfEnvelope<T>
    if (!parsed.success) {
      throw new ProviderApiError('cloudflare', response.status, JSON.stringify(parsed.errors))
    }
    return parsed.result
  }
}

interface CfEnvelope<T> {
  success: boolean
  errors: unknown[]
  result: T
}

interface CfZoneShape {
  id: string
  name: string
}

interface CfDnsRecordShape {
  id: string
  type: DnsRecordType
  name: string
  content: string
  ttl: number
  proxied: boolean
}

function mapRecord(raw: CfDnsRecordShape): DnsRecord {
  return {
    id: raw.id,
    type: raw.type,
    name: raw.name,
    content: raw.content,
    ttl: raw.ttl,
    proxied: raw.proxied,
  }
}
