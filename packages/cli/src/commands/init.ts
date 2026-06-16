// `rando init` — interactive bootstrap for fresh clones.
//
// Strategy:
//   1. Make sure .env exists (copy .env.example if not).
//   2. Run the doctor's env checks to see what's missing or invalid.
//   3. For each `env:<VAR>` failure, prompt for the value, validate it
//      by attempting the adapter probe, write back to .env.
//   4. Verify rando.config.json is present (don't auto-generate — point
//      the user at the config schema if it's missing).
//   5. Final doctor sweep so the user sees the green table.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command } from 'commander'
import type { Adapters } from '../config'
import { createAdapters } from '../config'
import { loadSetupConfig } from '../setup-config'
import type { SecretsProvider } from '../domain/secrets'
import type { Io } from '../output'
import { brewChecks } from '../doctor/checks/brew'
import { envChecks } from '../doctor/checks/env'
import { renderReport, runChecks } from '../doctor/run'
import { configChecks } from '../doctor/checks/config'
import { hooksChecks } from '../doctor/checks/hooks'
import { localChecks } from '../doctor/checks/local'
import { secretsChecks } from '../doctor/checks/secrets'
import { trackerChecks } from '../doctor/checks/tracker'
import { terminalChecks } from '../doctor/checks/terminal'
import { spawnSync } from 'node:child_process'
import { readEnv, setEnvValue, writeEnv } from '../init/env-file'

const DEFAULT_CONFIG_PATH = 'rando.config.json'

/**
 * Probe whether 1Password is usable for this `init` run. Returns the
 * vault/field convention + the live provider when everything checks
 * out, null when 1P is not configured, not signed in, or otherwise
 * unavailable. Errors are silent — 1P is a nice-to-have layer on top
 * of the prompt flow, so any failure falls through to manual entry.
 */
async function tryOpLookup(
  factory: () => SecretsProvider,
  configPath: string,
  io: Io,
): Promise<{
  provider: SecretsProvider
  vault: string
  field: string
  account: string
} | null> {
  // init always reads from the LOCAL vault — dev machines don't pull
  // staging or prod credentials. `rando secrets sync --env staging` is
  // the escape hatch for the rare "I need to debug staging values" case.
  let secretsConfig: { vault: string; field: string } | undefined
  try {
    const cfg = loadSetupConfig(resolve(process.cwd(), configPath))
    if (cfg.secrets) {
      secretsConfig = { vault: cfg.secrets.vaults.local, field: cfg.secrets.field }
    }
  } catch {
    // rando.config.json missing or invalid — no 1P lookup possible.
    return null
  }
  if (!secretsConfig) return null
  let provider: SecretsProvider
  try {
    provider = factory()
  } catch {
    return null
  }
  try {
    const me = await provider.whoami()
    return { provider, vault: secretsConfig.vault, field: secretsConfig.field, account: me.account }
  } catch {
    io.stdout(
      `${io.colors.hint('1Password not signed in — falling back to manual prompts. Run `op signin` then re-run init for vault-driven setup.')}`,
    )
    return null
  }
}

/**
 * Read `postman.workspaceId` from rando.config.json. Returns undefined
 * when the field, the postman block, or the whole file is missing —
 * each is a "user hasn't set this up yet" signal, not an error.
 */
function readPostmanWorkspaceId(configPath: string): string | undefined {
  try {
    const raw = readFileSync(resolve(process.cwd(), configPath), 'utf-8')
    const parsed = JSON.parse(raw) as { postman?: { workspaceId?: string } }
    return parsed.postman?.workspaceId
  } catch {
    return undefined
  }
}

/**
 * Write `postman.workspaceId` into rando.config.json, preserving
 * everything else. Reads → mutates → writes back with 2-space indent
 * + a trailing newline to match the existing file style.
 */
function writePostmanWorkspaceId(configPath: string, workspaceId: string): void {
  const path = resolve(process.cwd(), configPath)
  const raw = readFileSync(path, 'utf-8')
  const parsed = JSON.parse(raw) as Record<string, unknown> & {
    postman?: { workspaceId?: string }
  }
  parsed.postman = { ...(parsed.postman ?? {}), workspaceId }
  writeFileSync(path, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
}

/** Help text shown above each token prompt — terse one-liner per var. */
const TOKEN_HELP: Record<string, string> = {
  GITHUB_TOKEN: 'GitHub PAT (fine-grained, Read+Write Issues on the repo) — or `gh auth token`',
  NEON_API_KEY: 'Neon console → Settings → API keys (https://console.neon.tech)',
  CLOUDFLARE_API_TOKEN:
    'Cloudflare scoped token — see packages/cli/README.md → CLOUDFLARE_API_TOKEN',
  CLOUDFLARE_ACCOUNT_ID: 'Account ID from the Cloudflare dashboard right-hand sidebar',
  VERCEL_TOKEN: 'Vercel → Account Settings → Tokens (https://vercel.com/account/tokens)',
  VERCEL_TEAM_ID: 'Team ID — only if your Vercel projects live in a team',
  JIRA_BASE_URL: 'https://<workspace>.atlassian.net (no trailing slash)',
  JIRA_EMAIL: 'Your Atlassian account email',
  JIRA_API_TOKEN: 'Jira API token from https://id.atlassian.com/manage-profile/security/api-tokens',
  POSTMAN_API_KEY:
    'Postman API key from https://web.postman.co/settings/me/api-keys (used by `rando api postman sync`)',
}

export function initCommand(adapters: Adapters, io: Io): Command {
  return new Command('init')
    .description(
      'Interactive bootstrap for a fresh clone: fills in .env, validates each token, then runs a full doctor sweep.',
    )
    .option('--env-file <path>', 'Path to .env (default: repo root)', '.env')
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option(
      '--no-1password',
      'Skip fetching from 1Password — prompt for every missing var manually.',
    )
    .action(async (opts: { envFile: string; config: string; '1password': boolean }) => {
      const { colors } = io
      const envPath = resolve(process.cwd(), opts.envFile)
      const examplePath = resolve(process.cwd(), '.env.example')

      // 1. Ensure .env exists.
      if (!existsSync(envPath)) {
        if (existsSync(examplePath)) {
          copyFileSync(examplePath, envPath)
          io.stdout(
            `${colors.success('✓')} created ${colors.resource(opts.envFile)} from ${colors.resource('.env.example')}`,
          )
        } else {
          io.stderr(colors.warn(`no .env.example to copy from — creating an empty ${opts.envFile}`))
          writeEnv(envPath, { lines: [], index: new Map() })
        }
      }

      // 2. Probe env-var checks against the CURRENT process.env so we
      //    know what's already valid and what needs a prompt.
      io.stdout('')
      io.stdout(colors.bold('Probing env vars…'))
      const initialReport = await runChecks(envChecks(adapters))
      const toFix = initialReport.results
        .filter((r) => r.result.status !== 'ok' && r.result.fix?.startsWith('env:'))
        .map((r) => ({
          name: r.check.name,
          subject: r.result.subject,
          required: r.result.status === 'fail',
        }))

      if (toFix.length === 0) {
        io.stdout(`${colors.success('✓')} every env var is already set + valid`)
      } else {
        // Detect 1Password integration up front — if the user is signed in
        // and rando.config.json's `secrets` block is present, we'll try to
        // resolve each missing var from the vault before prompting.
        const opLookup = opts['1password']
          ? await tryOpLookup(adapters.secrets, opts.config, io)
          : null

        io.stdout(
          `${colors.hint(`${toFix.length} var(s) need attention${opLookup ? ` — trying 1Password (${opLookup.account}) first` : ' — prompting interactively'}`)}`,
        )
        io.stdout('')

        const envFile = readEnv(envPath)
        for (const entry of toFix) {
          const help = TOKEN_HELP[entry.name] ?? ''
          io.stdout(
            `${entry.required ? colors.warn('required') : colors.hint('optional')} ${colors.resource(entry.name)} ${colors.hint(`— ${entry.subject}`)}`,
          )
          if (help) io.stdout(`  ${colors.hint(help)}`)

          // 1Password first: build the canonical reference and try to
          // resolve. On hit, skip the prompt and validate the value the
          // same way as a manually-entered one. On miss, fall through.
          let value = ''
          if (opLookup) {
            const ref = `op://${opLookup.vault}/${entry.name}/${opLookup.field}`
            try {
              value = (await opLookup.provider.read(ref)).trim()
              if (value) {
                io.stdout(`  ${colors.success('✓')} fetched from ${colors.resource(ref)}`)
              }
            } catch {
              // Reference doesn't exist or other failure — silent fallback.
            }
          }
          if (!value) {
            value = (await io.input(`${entry.name}=`, { default: '' })).trim()
          }
          if (!value) {
            io.stdout(colors.hint(`  skipped`))
            io.stdout('')
            continue
          }

          // Validate by re-creating adapters with the new value patched
          // into a copy of process.env, then re-running the env probe
          // for this one key.
          const patched = { ...process.env, [entry.name]: value }
          const probeAdapters = createAdapters(patched)
          const reCheck = await runChecks(
            envChecks(probeAdapters, patched).filter((c) => c.name === entry.name),
          )
          const verdict = reCheck.results[0]?.result
          if (verdict?.status === 'ok') {
            setEnvValue(envFile, entry.name, value)
            io.stdout(`  ${colors.success('✓')} verified + written to ${opts.envFile}`)
          } else {
            io.stdout(
              `  ${colors.error('✗')} ${verdict?.subject ?? 'invalid'} — ${colors.hint(verdict?.hint ?? 'not written')}`,
            )
          }
          io.stdout('')
        }
        writeEnv(envPath, envFile)
        io.stdout(
          `${colors.success('✓')} ${colors.resource(opts.envFile)} updated. Restart any shells that had the old env loaded.`,
        )
      }

      // 3. Brewfile — offer to install any missing system deps before
      //    the final sweep so the user only sees a green table.
      const brewReport = await runChecks(brewChecks())
      const brewResult = brewReport.results[0]?.result
      if (brewResult?.fix === 'brew:bundle') {
        io.stdout('')
        io.stdout(
          `${colors.warn('⚠')} Brewfile has missing deps (${colors.hint(brewResult.hint ?? '')})`,
        )
        const ok = await io.confirm('Run `brew bundle install` now?')
        if (ok) {
          const proc = spawnSync('brew', ['bundle', 'install'], { stdio: 'inherit' })
          if (proc.status === 0) {
            io.stdout(`${colors.success('✓')} Brewfile deps installed`)
          } else {
            io.stdout(
              `${colors.error('✗')} brew bundle install exited ${proc.status} — re-run manually for details`,
            )
          }
        }
      }

      // 4. rando on PATH — if the symlink isn't there yet, offer to
      //    run `pnpm setup:cli` so subsequent invocations can drop the
      //    `pnpm` prefix.
      const symlinkPath = spawnSync('command', ['-v', 'rando'], {
        shell: '/bin/sh',
        encoding: 'utf-8',
      })
      if (!symlinkPath.stdout?.trim()) {
        io.stdout('')
        io.stdout(`${colors.warn('⚠')} \`rando\` is not on PATH yet.`)
        const ok = await io.confirm('Run `pnpm setup:cli` to symlink it into ~/.local/bin?')
        if (ok) {
          const proc = spawnSync('pnpm', ['setup:cli'], { stdio: 'inherit' })
          if (proc.status === 0) {
            io.stdout(
              `${colors.success('✓')} \`rando\` symlinked — restart your shell to pick it up`,
            )
          } else {
            io.stdout(
              `${colors.error('✗')} setup:cli exited ${proc.status} — keep using \`pnpm rando\` for now`,
            )
          }
        }
      }

      // 5. Postman workspace selection — only when POSTMAN_API_KEY is set
      //    (validated by the env loop above). If the config already
      //    has a workspaceId, skip silently. Otherwise list the user's
      //    workspaces, let them pick, write to rando.config.json.
      if (process.env.POSTMAN_API_KEY) {
        try {
          const postman = adapters.postman()
          const existingWsId = readPostmanWorkspaceId(opts.config)
          if (!existingWsId) {
            io.stdout('')
            io.stdout(colors.bold('Postman: pick a workspace for OpenAPI sync'))
            const me = await postman.getMyself()
            io.stdout(`  ${colors.hint(`signed in as ${me.fullName} (@${me.username})`)}`)
            const workspaces = await postman.listWorkspaces()
            if (workspaces.length === 0) {
              io.stdout(
                `  ${colors.warn('no workspaces — create one at https://web.postman.co then re-run init')}`,
              )
            } else {
              const chosen = await io.select(
                'Which workspace should hold the Rando API collection?',
                workspaces.map((w) => ({
                  name: `${w.name} (${w.type})`,
                  value: w.id,
                  description: w.id,
                })),
              )
              try {
                writePostmanWorkspaceId(opts.config, chosen)
                io.stdout(
                  `  ${colors.success('✓')} postman.workspaceId = ${colors.resource(chosen)} → ${opts.config}`,
                )
              } catch (e) {
                io.stdout(
                  `  ${colors.warn("couldn't write to rando.config.json:")} ${e instanceof Error ? e.message : String(e)}`,
                )
                io.stdout(
                  `  ${colors.hint(`add { "postman": { "workspaceId": "${chosen}" } } to rando.config.json manually`)}`,
                )
              }
            }
          }
        } catch (e) {
          io.stdout('')
          io.stdout(
            `${colors.warn('Postman setup skipped:')} ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }

      // 6. Final sweep — full doctor. Helps the user see what's still
      //    on the table (config gaps, missing local tooling, etc.).
      //    Re-load adapters from the freshly-written .env so the table
      //    reflects what's on disk, not what was in process.env at
      //    startup.
      io.stdout('')
      io.stdout(colors.bold('Final health check…'))
      io.stdout('')
      const freshAdapters = adapters // .env on disk; bin's --env-file already loaded it for this process
      const report = await runChecks([
        ...envChecks(freshAdapters),
        ...configChecks(opts.config),
        ...hooksChecks(),
        ...localChecks(),
        ...brewChecks(),
        ...trackerChecks(freshAdapters, opts.config),
        ...secretsChecks(freshAdapters, opts.config),
        ...terminalChecks(),
      ])
      renderReport(io, report)

      // 7. Suggested next commands — only shown when the env is in a
      //    usable state. Skip if anything failed so the user fixes
      //    those first.
      if (!report.hasFailures) {
        io.stdout('')
        io.stdout(colors.bold('Suggested next steps:'))
        io.stdout(
          `  ${colors.resource('rando dev')}            ${colors.hint('— start the local dev orchestrator (Docker + tunnel + 3 apps)')}`,
        )
        io.stdout(
          `  ${colors.resource('rando issues list --mine')} ${colors.hint('— see your open tickets')}`,
        )
        io.stdout(
          `  ${colors.resource('rando issues pick')}      ${colors.hint('— tie the current branch to an issue (auto-picked on commit)')}`,
        )
        io.stdout(
          `  ${colors.resource('rando infra setup')}       ${colors.hint('— provision Neon + Cloudflare + Vercel from rando.config.json (first-time only)')}`,
        )
        io.stdout('')
        io.stdout(
          colors.hint(
            'See `rando --help` for the full surface. Re-run `rando doctor` anytime to re-check.',
          ),
        )
      } else {
        process.exitCode = 1
      }
    })
}
