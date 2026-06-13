// Interactive command discovery. When the user runs `rando` with no
// subcommand (or `rando db` with no leaf), drop them into a select menu so
// they can navigate the surface without consulting --help.
//
// The menu just builds an argv and re-dispatches through commander —
// individual commands stay non-interactive at their action layer, which
// keeps tests deterministic and scripted use scriptable.

import type { Io } from './output'

interface MenuItem {
  label: string
  description: string
  /** argv to dispatch when this item is selected (relative to root program). */
  argv: string[]
}

interface MenuGroup {
  key: string
  label: string
  description: string
  items: MenuItem[]
}

/** The interactive surface — kept in one place so it's easy to scan/extend. */
const GROUPS: MenuGroup[] = [
  {
    key: 'infra',
    label: 'infra',
    description: 'End-to-end orchestration (read rando.config.json, drive every provider)',
    items: [
      {
        label: 'setup',
        description: 'Provision DB + tunnel + deploys + DNS from rando.config.json',
        argv: ['infra', 'setup'],
      },
      {
        label: 'destroy',
        description: 'Tear down a single env (prod is refused)',
        argv: ['infra', 'destroy'],
      },
    ],
  },
  {
    key: 'db',
    label: 'db',
    description: 'Neon database — projects, branches, connection strings, extensions',
    items: [
      { label: 'project list', description: 'List Neon projects', argv: ['db', 'project', 'list'] },
      {
        label: 'project create',
        description: 'Create a new Neon project (escape-hatch — usually `infra setup`)',
        argv: ['db', 'project', 'create'],
      },
      {
        label: 'project delete',
        description: 'Delete a Neon project (escape-hatch — usually the dashboard)',
        argv: ['db', 'project', 'delete'],
      },
      {
        label: 'branch list',
        description: 'List branches in a project',
        argv: ['db', 'branch', 'list'],
      },
      {
        label: 'branch create',
        description: 'Create a branch under a project',
        argv: ['db', 'branch', 'create'],
      },
      {
        label: 'branch delete',
        description: 'Delete a branch (irreversible)',
        argv: ['db', 'branch', 'delete'],
      },
      {
        label: 'connection-string',
        description: 'Print a connection string for a branch',
        argv: ['db', 'connection-string'],
      },
      {
        label: 'extension-enable',
        description: 'Enable a Postgres extension on a branch',
        argv: ['db', 'extension-enable'],
      },
      {
        label: 'sync',
        description: 'Reset one branch to match another (e.g. main → staging)',
        argv: ['db', 'sync'],
      },
      {
        label: 'copy',
        description: 'Copy a Postgres DB via pg_dump | pg_restore (cross-project)',
        argv: ['db', 'copy'],
      },
    ],
  },
  {
    key: 'tunnel',
    label: 'tunnel',
    description: 'Cloudflare Tunnel — create/delete tunnel and manage routes',
    items: [
      { label: 'list', description: 'List tunnels', argv: ['tunnel', 'list'] },
      { label: 'create', description: 'Create a new tunnel', argv: ['tunnel', 'create'] },
      {
        label: 'delete',
        description: 'Delete a tunnel (cascades routes + tunnel DNS)',
        argv: ['tunnel', 'delete'],
      },
      { label: 'token', description: 'Print the connector token', argv: ['tunnel', 'token'] },
      {
        label: 'route add',
        description: 'Add a hostname → service route',
        argv: ['tunnel', 'route', 'add'],
      },
      {
        label: 'route list',
        description: 'List routes on a tunnel',
        argv: ['tunnel', 'route', 'list'],
      },
      {
        label: 'route remove',
        description: 'Remove a hostname route',
        argv: ['tunnel', 'route', 'remove'],
      },
    ],
  },
  {
    key: 'deploy',
    label: 'deploy',
    description: 'Vercel — manage deploy apps, env vars, custom domains',
    items: [
      { label: 'app list', description: 'List deploy apps', argv: ['deploy', 'app', 'list'] },
      {
        label: 'app create',
        description: 'Create a new deploy app',
        argv: ['deploy', 'app', 'create'],
      },
      {
        label: 'app delete',
        description: 'Delete a deploy app and all its deployments',
        argv: ['deploy', 'app', 'delete'],
      },
      {
        label: 'env set',
        description: 'Set an env var on a deploy app',
        argv: ['deploy', 'env', 'set'],
      },
      {
        label: 'env list',
        description: 'List env vars on a deploy app',
        argv: ['deploy', 'env', 'list'],
      },
      {
        label: 'domain add',
        description: 'Attach a custom domain to a deploy app',
        argv: ['deploy', 'domain', 'add'],
      },
      {
        label: 'domain remove',
        description: 'Remove a custom domain from a deploy app',
        argv: ['deploy', 'domain', 'remove'],
      },
      {
        label: 'branch',
        description: 'Trigger Vercel preview deploys for a git branch',
        argv: ['deploy', 'branch'],
      },
      {
        label: 'teardown',
        description: 'Inverse of `branch --stable-url` — remove per-branch domains + DNS',
        argv: ['deploy', 'teardown'],
      },
    ],
  },
  {
    key: 'dns',
    label: 'dns',
    description: 'Cloudflare DNS — records on a zone',
    items: [
      { label: 'record list', description: 'List DNS records', argv: ['dns', 'record', 'list'] },
      { label: 'record add', description: 'Add a DNS record', argv: ['dns', 'record', 'add'] },
      {
        label: 'record remove',
        description: 'Remove a DNS record by id',
        argv: ['dns', 'record', 'remove'],
      },
    ],
  },
  {
    key: 'dev',
    label: 'dev',
    description: 'Local dev — preflight + cloudflared + apps with colored logs',
    items: [
      { label: 'all', description: 'Run every app + cloudflared', argv: ['dev'] },
      { label: 'api', description: 'Run just the API', argv: ['dev', 'api'] },
      { label: 'web', description: 'Run web (api auto-starts as dep)', argv: ['dev', 'web'] },
      {
        label: 'admin',
        description: 'Run admin (api auto-starts as dep)',
        argv: ['dev', 'admin'],
      },
      {
        label: 'native',
        description: 'Run native (api auto-starts as dep)',
        argv: ['dev', 'native'],
      },
    ],
  },
  {
    key: 'doctor',
    label: 'doctor',
    description: 'Diagnose terminal color + spinner support',
    items: [
      {
        label: 'run',
        description: 'Print env diagnostics + color/spinner samples',
        argv: ['doctor'],
      },
    ],
  },
]

/**
 * Drop the user into the top-level menu. Returns the chosen argv (caller
 * dispatches it through commander). Throws if no TTY is available — the
 * caller should fall back to `--help` in that case.
 */
export async function pickFromMenu(io: Io, group?: string): Promise<string[]> {
  if (group) {
    const found = GROUPS.find((g) => g.key === group)
    if (!found)
      throw new Error(
        `Unknown group "${group}" — pass one of: ${GROUPS.map((g) => g.key).join(', ')}`,
      )
    return pickFromGroup(io, found)
  }
  const chosenKey = await io.select(io.colors.bold('rando — pick a command group:'), [
    ...GROUPS.map((g) => ({ name: g.label, value: g.key, description: g.description })),
  ])
  const chosen = GROUPS.find((g) => g.key === chosenKey)
  if (!chosen) throw new Error(`Unknown group "${chosenKey}"`)
  return pickFromGroup(io, chosen)
}

async function pickFromGroup(io: Io, group: MenuGroup): Promise<string[]> {
  const chosen = await io.select<MenuItem>(
    io.colors.bold(`rando ${group.label} — pick a command:`),
    group.items.map((item) => ({
      name: item.label,
      value: item,
      description: item.description,
    })),
  )
  io.stdout(io.colors.hint(`→ rando ${chosen.argv.join(' ')}`))
  return chosen.argv
}

export function isInteractiveCandidate(argv: string[]): { group?: string } | null {
  if (argv.length === 0) return {}
  // `rando <group>` with no further args — show that group's submenu.
  const first = argv[0]
  if (argv.length === 1 && first && GROUPS.some((g) => g.key === first)) {
    return { group: first }
  }
  return null
}
