import { Command } from 'commander'
import type { Adapters } from '../config'
import type { DnsRecordType } from '../domain/dns'
import { emit, table, type Io, type SelectChoice } from '../output'
import { confirmDestructive } from './_confirm'
import { askOr, pickOr } from './_interactive'

const TYPES: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'TXT', 'MX']

function parseType(raw: string): DnsRecordType {
  const upper = raw.toUpperCase() as DnsRecordType
  if (!TYPES.includes(upper)) {
    throw new Error(`Invalid record type "${raw}". Must be one of: ${TYPES.join(', ')}`)
  }
  return upper
}

export function dnsCommand(adapters: Adapters, io: Io): Command {
  const { colors } = io
  const dns = new Command('dns').description('DNS record operations')

  const recordChoices = async (zone: string): Promise<SelectChoice<string>[]> => {
    const list = await adapters.dns().listRecords({ zone })
    return list.map((r) => ({
      name: `${r.name}`,
      value: r.id,
      description: `${r.type} → ${r.content}`,
    }))
  }
  const typeChoices: SelectChoice<DnsRecordType>[] = TYPES.map((t) => ({
    name: t,
    value: t,
  }))

  const record = new Command('record').description('Manage DNS records')

  record
    .command('add [zone] [type] [name] [content]')
    .description('Add a DNS record (type: A, AAAA, CNAME, TXT, MX)')
    .option('--ttl <ttl>', 'TTL in seconds (1 = auto)', '1')
    .option('--proxied', 'Route through Cloudflare proxy (orange cloud)', false)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        zoneArg: string | undefined,
        typeArg: string | undefined,
        nameArg: string | undefined,
        contentArg: string | undefined,
        opts: { ttl: string; proxied: boolean; json: boolean },
      ) => {
        const zone = await askOr(io, zoneArg, 'Zone (e.g. rando-id.dev):', 'zone')
        const type = typeArg
          ? parseType(typeArg)
          : await pickOr<DnsRecordType>(
              io,
              undefined,
              async () => typeChoices,
              'Record type:',
              'type',
            )
        const name = await askOr(io, nameArg, 'Record name (subdomain or "@"):', 'name')
        const content = await askOr(io, contentArg, 'Target / content:', 'content')

        const ttl = Number.parseInt(opts.ttl, 10)
        if (Number.isNaN(ttl)) throw new Error(`Invalid --ttl: ${opts.ttl}`)
        const r = await adapters.dns().addRecord({
          zone,
          type,
          name,
          content,
          ttl,
          proxied: opts.proxied,
        })
        emit(
          io,
          opts.json,
          r,
          (x) =>
            `${colors.success('✓')} added ${colors.bold(x.type)} ${colors.resource(x.name)} → ${colors.hint(x.content)}`,
        )
      },
    )

  record
    .command('list [zone]')
    .description('List DNS records in a zone')
    .option('--json', 'Emit raw JSON', false)
    .action(async (zoneArg: string | undefined, opts: { json: boolean }) => {
      const zone = await askOr(io, zoneArg, 'Zone:', 'zone')
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
          colors,
        ),
      )
    })

  record
    .command('remove [zone] [recordId]')
    .description('Remove a DNS record by id')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        zoneArg: string | undefined,
        recordIdArg: string | undefined,
        opts: { yes: boolean; json: boolean },
      ) => {
        const zone = await askOr(io, zoneArg, 'Zone:', 'zone')
        const recordId = await pickOr(
          io,
          recordIdArg,
          () => recordChoices(zone),
          'Which record to remove?',
          'recordId',
        )
        const ok = await confirmDestructive(
          io,
          opts,
          `Remove DNS record ${colors.resource(`"${recordId}"`)} from zone ${colors.resource(`"${zone}"`)}?`,
        )
        if (!ok) {
          io.stdout(colors.hint('aborted.'))
          return
        }
        await adapters.dns().removeRecord({ zone, recordId })
        emit(
          io,
          opts.json,
          { ok: true },
          () => `${colors.success('✓')} removed record: ${colors.resource(recordId)}`,
        )
      },
    )

  dns.addCommand(record)
  return dns
}
