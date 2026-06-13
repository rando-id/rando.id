# `rando` CLI — spec

A unified CLI for driving Rando.id's infrastructure (DB, tunnel, deploy, DNS)
without touching vendor dashboards. Lives in `packages/cli`.

## Architecture

Port-and-adapter. Domain interfaces describe operations (`db`, `tunnel`,
`deploy`, `dns`); vendor-specific adapters implement them. Swapping Neon →
Supabase later only changes one file.

```
packages/cli/
├── bin/rando.js                       # shebang entrypoint
├── package.json                       # @rando/cli, exposes `rando` bin
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── cli.ts                         # commander root, dispatches subcommands
    ├── config.ts                      # zod-validated env loader; chooses adapters
    ├── domain/
    │   ├── db.ts                      # DbProvider interface
    │   ├── tunnel.ts                  # TunnelProvider interface
    │   ├── deploy.ts                  # DeployProvider interface
    │   └── dns.ts                     # DnsProvider interface
    ├── adapters/
    │   ├── neon.ts                    # DbProvider via Neon API
    │   ├── cloudflare-tunnel.ts       # TunnelProvider via Cloudflare API
    │   ├── cloudflare-dns.ts          # DnsProvider via Cloudflare API
    │   └── vercel.ts                  # DeployProvider via Vercel API
    ├── commands/
    │   ├── db.ts
    │   ├── tunnel.ts
    │   ├── deploy.ts
    │   └── dns.ts
    └── __tests__/…                    # vitest, per-adapter + per-command
```

## Commands

```
rando db project create <name>
rando db project list
rando db branch create <name> [--from <src>]
rando db branch list
rando db connection-string <branch> [--pooled]
rando db extension enable <branch> <name>          # e.g. postgis

rando tunnel create <name>
rando tunnel list
rando tunnel token <name>
rando tunnel route add <tunnel> <host> <service>
rando tunnel route list <tunnel>
rando tunnel route remove <tunnel> <host>

rando deploy project create <name> --root <path> --repo <owner/name>
rando deploy project list
rando deploy env set <project> <key> <value> --scope <production|preview|development>
rando deploy env list <project>
rando deploy domain add <project> <host> [--branch <branch>]

rando dns record add <zone> <type> <name> <target>
rando dns record list <zone>
rando dns record remove <zone> <id>
```

## Env vars (validated on startup)

| Var                     | Used by           |
| ----------------------- | ----------------- |
| `NEON_API_KEY`          | db                |
| `CLOUDFLARE_API_TOKEN`  | tunnel, dns       |
| `CLOUDFLARE_ACCOUNT_ID` | tunnel, dns       |
| `VERCEL_TOKEN`          | deploy            |
| `VERCEL_TEAM_ID`        | deploy (optional) |

The CLI lazy-validates — `rando db ...` only needs Neon creds, etc. So you
can run partial setups without all keys.

## Implementation choices

- **HTTP via Node 22's `fetch`**, not vendor SDKs. Keeps adapters thin
  (~150 lines each) and the swap story honest. Each adapter is one file.
- **`commander`** for arg parsing — standard, supports the nested
  subcommand shape.
- **`zod`** for env validation (already a workspace dep).
- **`vitest`** for tests. Adapter tests mock `fetch` and assert URL/method/
  body. Command tests mock the provider interface and assert the command
  translated args correctly + emitted the right output.
- No interactive prompts — if a flag is missing, fail loud. Easier to
  script and test.
- JSON output for read commands; human-readable summary for writes. `--json`
  flag everywhere for raw output.

## Out of scope for v1

- GitHub adapter (branch protection blocked by free org plan anyway)
- Sentry / PostHog adapters (not wired yet)
- "Set up everything in one command" — keep commands granular per the
  product spec
- Live API integration tests — mocked-fetch unit tests only

## Documentation deliverables

After build:

- New section in `INFRASTRUCTURE.md` showing how each manual step in that
  doc maps to a `rando` command.
- New `packages/cli/README.md` with full command reference.
