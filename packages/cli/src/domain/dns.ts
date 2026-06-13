// DNS domain interface. Implemented by vendor-specific adapters (Cloudflare,
// Route53, etc.). Zone-scoped — most DNS providers organize records under a
// "zone" (the apex domain).

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX'

export interface DnsRecord {
  id: string
  type: DnsRecordType
  /** Subdomain or "@" for apex. */
  name: string
  /** Target value (IP for A, hostname for CNAME, etc.). */
  content: string
  ttl: number
  proxied: boolean
}

export interface DnsProvider {
  /** Add a DNS record to a zone (referenced by zone name like "rando-id.dev"). */
  addRecord(input: {
    zone: string
    type: DnsRecordType
    name: string
    content: string
    ttl?: number
    proxied?: boolean
  }): Promise<DnsRecord>

  /** List records in a zone. */
  listRecords(input: { zone: string }): Promise<DnsRecord[]>

  /** Remove a record by id. */
  removeRecord(input: { zone: string; recordId: string }): Promise<void>
}
