import { Command } from 'commander'
import type { Adapters } from '../config'
import { NotFoundError } from '../domain/errors'
import { emit, table, type Io } from '../output'
import { confirmDestructive } from './_confirm'

export function tunnelCommand(adapters: Adapters, io: Io): Command {
  const { colors } = io
  const tunnel = new Command('tunnel').description('Dev tunnel operations')

  tunnel
    .command('create <name>')
    .description('Create a new dev tunnel')
    .option('--json', 'Emit raw JSON', false)
    .action(async (name: string, opts: { json: boolean }) => {
      const t = await adapters.tunnel().createTunnel({ name })
      emit(
        io,
        opts.json,
        t,
        (x) =>
          `${colors.success('✓')} created tunnel: ${colors.resource(x.name)} ${colors.hint(`(${x.id})`)}`,
      )
    })

  tunnel
    .command('list')
    .description('List tunnels')
    .option('--json', 'Emit raw JSON', false)
    .action(async (opts: { json: boolean }) => {
      const list = await adapters.tunnel().listTunnels()
      emit(io, opts.json, list, (rows) =>
        table(
          rows.map((t) => ({ id: t.id, name: t.name })),
          colors,
        ),
      )
    })

  tunnel
    .command('delete <name>')
    .description('Delete a tunnel (cascade removes routes + tunnel DNS).')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(async (name: string, opts: { yes: boolean; json: boolean }) => {
      const provider = adapters.tunnel()
      const t = await provider.getTunnelByName({ name })
      if (!t) throw new NotFoundError('tunnel', name)
      const ok = await confirmDestructive(
        io,
        opts,
        `Delete tunnel ${colors.resource(`"${name}"`)} ${colors.hint(`(${t.id})`)}?`,
      )
      if (!ok) {
        io.stdout(colors.hint('aborted.'))
        return
      }
      await provider.deleteTunnel({ tunnelId: t.id })
      emit(
        io,
        opts.json,
        { ok: true, name, id: t.id },
        () => `${colors.success('✓')} deleted tunnel: ${colors.resource(name)}`,
      )
    })

  tunnel
    .command('token <name>')
    .description('Print the connector token for a tunnel')
    .option('--json', 'Emit raw JSON', false)
    .action(async (name: string, opts: { json: boolean }) => {
      const provider = adapters.tunnel()
      const t = await provider.getTunnelByName({ name })
      if (!t) throw new NotFoundError('tunnel', name)
      const token = await provider.getTunnelToken({ tunnelId: t.id })
      emit(io, opts.json, { token }, () => token)
    })

  const route = new Command('route').description('Manage tunnel routes')

  route
    .command('add <tunnel> <hostname> <service>')
    .description('Add a hostname → service route to a tunnel')
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (tunnelName: string, hostname: string, service: string, opts: { json: boolean }) => {
        const provider = adapters.tunnel()
        const t = await provider.getTunnelByName({ name: tunnelName })
        if (!t) throw new NotFoundError('tunnel', tunnelName)
        const r = await provider.addRoute({ tunnelId: t.id, hostname, service })
        emit(
          io,
          opts.json,
          r,
          (x) =>
            `${colors.success('✓')} added route: ${colors.resource(x.hostname)} → ${colors.hint(x.service)}`,
        )
      },
    )

  route
    .command('list <tunnel>')
    .description('List routes on a tunnel')
    .option('--json', 'Emit raw JSON', false)
    .action(async (tunnelName: string, opts: { json: boolean }) => {
      const provider = adapters.tunnel()
      const t = await provider.getTunnelByName({ name: tunnelName })
      if (!t) throw new NotFoundError('tunnel', tunnelName)
      const list = await provider.listRoutes({ tunnelId: t.id })
      emit(io, opts.json, list, (rows) =>
        table(
          rows.map((r) => ({ hostname: r.hostname, service: r.service })),
          colors,
        ),
      )
    })

  route
    .command('remove <tunnel> <hostname>')
    .description('Remove a hostname route from a tunnel')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(async (tunnelName: string, hostname: string, opts: { yes: boolean; json: boolean }) => {
      const provider = adapters.tunnel()
      const t = await provider.getTunnelByName({ name: tunnelName })
      if (!t) throw new NotFoundError('tunnel', tunnelName)
      const ok = await confirmDestructive(
        io,
        opts,
        `Remove route ${colors.resource(`"${hostname}"`)} from tunnel ${colors.resource(`"${tunnelName}"`)}?`,
      )
      if (!ok) {
        io.stdout(colors.hint('aborted.'))
        return
      }
      await provider.removeRoute({ tunnelId: t.id, routeId: hostname })
      emit(
        io,
        opts.json,
        { ok: true },
        () => `${colors.success('✓')} removed route: ${colors.resource(hostname)}`,
      )
    })

  tunnel.addCommand(route)
  return tunnel
}
