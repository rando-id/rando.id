import { Command } from 'commander'
import type { Adapters } from '../config'
import { NotFoundError } from '../domain/errors'
import { emit, table, type Io, type SelectChoice } from '../output'
import { confirmDestructive } from './_confirm'
import { askOr, pickOr } from './_interactive'

export function tunnelCommand(adapters: Adapters, io: Io): Command {
  const { colors } = io
  const tunnel = new Command('tunnel').description('Dev tunnel operations')

  // Loaders for select-from-list prompts.
  const tunnelChoices = async (): Promise<SelectChoice<string>[]> => {
    const list = await adapters.tunnel().listTunnels()
    return list.map((t) => ({ name: t.name, value: t.name, description: t.id }))
  }
  const routeChoices = async (tunnelId: string): Promise<SelectChoice<string>[]> => {
    const list = await adapters.tunnel().listRoutes({ tunnelId })
    return list.map((r) => ({ name: r.hostname, value: r.hostname, description: r.service }))
  }

  tunnel
    .command('create [name]')
    .description('Create a new dev tunnel')
    .option('--json', 'Emit raw JSON', false)
    .action(async (nameArg: string | undefined, opts: { json: boolean }) => {
      const name = await askOr(io, nameArg, 'New tunnel name:', 'name')
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
    .command('delete [name]')
    .description('Delete a tunnel (cascade removes routes + tunnel DNS).')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(async (nameArg: string | undefined, opts: { yes: boolean; json: boolean }) => {
      const provider = adapters.tunnel()
      const name = await pickOr(io, nameArg, tunnelChoices, 'Which tunnel to delete?', 'name')
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
    .command('token [name]')
    .description('Print the connector token for a tunnel')
    .option('--json', 'Emit raw JSON', false)
    .action(async (nameArg: string | undefined, opts: { json: boolean }) => {
      const provider = adapters.tunnel()
      const name = await pickOr(io, nameArg, tunnelChoices, "Which tunnel's token?", 'name')
      const t = await provider.getTunnelByName({ name })
      if (!t) throw new NotFoundError('tunnel', name)
      const token = await provider.getTunnelToken({ tunnelId: t.id })
      emit(io, opts.json, { token }, () => token)
    })

  const route = new Command('route').description('Manage tunnel routes')

  route
    .command('add [tunnel] [hostname] [service]')
    .description('Add a hostname → service route to a tunnel')
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        tunnelNameArg: string | undefined,
        hostnameArg: string | undefined,
        serviceArg: string | undefined,
        opts: { json: boolean },
      ) => {
        const provider = adapters.tunnel()
        const tunnelName = await pickOr(io, tunnelNameArg, tunnelChoices, 'Which tunnel?', 'tunnel')
        const t = await provider.getTunnelByName({ name: tunnelName })
        if (!t) throw new NotFoundError('tunnel', tunnelName)
        const hostname = await askOr(
          io,
          hostnameArg,
          'Public hostname (e.g. dev-api.rando-id.dev):',
          'hostname',
        )
        const service = await askOr(
          io,
          serviceArg,
          'Local service URL (e.g. http://host.docker.internal:4000):',
          'service',
        )
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
    .command('list [tunnel]')
    .description('List routes on a tunnel')
    .option('--json', 'Emit raw JSON', false)
    .action(async (tunnelNameArg: string | undefined, opts: { json: boolean }) => {
      const provider = adapters.tunnel()
      const tunnelName = await pickOr(io, tunnelNameArg, tunnelChoices, 'Which tunnel?', 'tunnel')
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
    .command('remove [tunnel] [hostname]')
    .description('Remove a hostname route from a tunnel')
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        tunnelNameArg: string | undefined,
        hostnameArg: string | undefined,
        opts: { yes: boolean; json: boolean },
      ) => {
        const provider = adapters.tunnel()
        const tunnelName = await pickOr(io, tunnelNameArg, tunnelChoices, 'Which tunnel?', 'tunnel')
        const t = await provider.getTunnelByName({ name: tunnelName })
        if (!t) throw new NotFoundError('tunnel', tunnelName)
        const hostname = await pickOr(
          io,
          hostnameArg,
          () => routeChoices(t.id),
          'Which route to remove?',
          'hostname',
        )
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
      },
    )

  tunnel.addCommand(route)
  return tunnel
}
