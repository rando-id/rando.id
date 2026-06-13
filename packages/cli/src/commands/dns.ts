import { Command } from 'commander'
import type { Adapters } from '../config'
import type { DnsRecordType } from '../domain/dns'
import { emit, table, type Io } from '../output'
import { confirmDestructive } from './_confirm'

const TYPES: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'TXT', 'MX']

function parseType(raw: string): DnsRecordType {
  const upper = raw.toUpperCase() as DnsRecordType
  if (!TYPES.includes(upper)) {
    throw new Error(`Invalid record type "${raw}". Must be one of: ${TYPES.join(', ')}`)
  }
  return upper
}

export function dnsCommand(adapters: Adapters, io: Io): Command {
  const dns = new Command('dns').description('DNS record operations')

  const record = new Command('record').description('Manage DNS records')

  record
    .command('add <zone> <type> <name> <content>')
    .description('Add a DNS record (type: A, AAAA, CNAME, TXT, MX)')
    .option('--ttl <ttl>', 'TTL in seconds (1 = auto)', '1')
    .option('--proxied', 'Route through Cloudflare proxy (orange cloud)', false)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        zone: string,
        type: string,
        name: string,
        content: string,
        opts: { ttl: string; proxied: boolean; json: boolean },
      ) => {
        const ttl = Number.parseInt(opts.ttl, 10)
        if (Number.isNaN(ttl)) throw new Error(`Invalid --ttl: ${opts.ttl}`)
        const r = await adapters.dns().addRecord({
          zone,
          type: parseType(type),
          name,
          content,
          ttl,
          proxied: opts.proxied,
        })
        emit(io, opts.json, r, (x) => `added ${x.type} ${x.name} → ${x.content}`)
      },
    )

  record
    .command('list <zone>')
    .description('List DNS records in a zone')
    .option('--json', 'Emit raw JSON', false)
    .action(async (zone: string, opts: { json: boolean }) => {
      const list = await adapters.dns().listRecords({ zone })
      emit(io, opts.json, list, (rows) =>
        table(
          rows.map((r) => ({
            id: r.id,
            type: r.type,
            name: r.name,
            content: r.content,
            ttl: r.ttl.toString(),
            proxied: r.proxied ? 'yes' : 'no',
          })),
        ),
      )
    })

  record
    .command('remove <zone> <recordId>')
    .description('Remove a DNS record by id')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(async (zone: string, recordId: string, opts: { yes: boolean; json: boolean }) => {
      const ok = await confirmDestructive(
        io,
        opts,
        `Remove DNS record "${recordId}" from zone "${zone}"?`,
      )
      if (!ok) {
        io.stdout('aborted.')
        return
      }
      await adapters.dns().removeRecord({ zone, recordId })
      emit(io, opts.json, { ok: true }, () => `removed record: ${recordId}`)
    })

  dns.addCommand(record)
  return dns
}
