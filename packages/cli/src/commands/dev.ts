// `rando dev` — preflight + spawn cloudflared + run selected apps with
// colored log prefixes. Replaces the muscle-memory of "docker compose up,
// docker compose --profile tunnel up, pnpm dev" with a single command.

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import type { Io } from '../output'
import { expandApps, KNOWN_APPS, parseAppNames, type KnownApp } from '../dev/deps'
import { runPreflight } from '../dev/preflight'
import { runSupervisor, type ChildSpec } from '../dev/supervisor'

/** Resolve the repo root from the bin script's location. */
function findRepoRoot(): string {
  // src/commands/dev.ts → up three: src/commands, src, packages/cli, repo root
  return resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..')
}

export function devCommand(io: Io): Command {
  const { colors } = io
  return new Command('dev')
    .description(
      'Run local dev — checks Docker, ensures cloudflared is up, then spawns one or more apps with colored logs',
    )
    .argument('[apps...]', `Apps to run (default: all). One or more of: ${KNOWN_APPS.join(', ')}.`)
    .option('--no-tunnel', 'Skip starting the Cloudflare Tunnel container')
    .option('--no-preflight', 'Skip preflight checks (Docker daemon, env vars)')
    .action(async (rawApps: string[], opts: { tunnel: boolean; preflight: boolean }) => {
      const apps: KnownApp[] = expandApps(parseAppNames(rawApps))
      const repoRoot = findRepoRoot()

      if (opts.preflight !== false) {
        const pre = runPreflight({ env: process.env })
        if (!pre.ok) {
          for (const issue of pre.issues) io.stderr(`${colors.error('preflight:')} ${issue}`)
          throw new Error('preflight checks failed — fix the issues above and re-run')
        }
        io.stdout(colors.hint('preflight: ok'))
      }

      // Build the child list. cloudflared via docker compose first (so its
      // first log lines beat the api boot), then each app via pnpm filter.
      const children: ChildSpec[] = []
      if (opts.tunnel !== false) {
        children.push({
          name: 'cloudflared',
          command: 'docker',
          args: ['compose', '--profile', 'tunnel', 'up', '--no-log-prefix'],
          cwd: repoRoot,
        })
      }
      for (const app of apps) {
        children.push({
          name: app,
          command: 'pnpm',
          args: ['--filter', `@rando/${app}`, 'dev'],
          cwd: repoRoot,
        })
      }

      io.stdout(`${colors.hint('apps:')} ${apps.map((a) => colors.resource(a)).join(', ')}`)
      if (opts.tunnel !== false) io.stdout(colors.hint('tunnel: cloudflared (docker compose)'))
      io.stdout(colors.hint('press Ctrl+C to stop everything cleanly'))
      io.stdout('')

      const result = await runSupervisor(io, children)
      if (result.code !== 0) {
        process.exitCode = result.code
      }
    })
}
