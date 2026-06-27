// `rando version-control` (alias `vc`) — provision version-control hosting
// state (rulesets, environments, secrets, repo settings) via REST API.
// Today the only backend is GitHub; the command surface stays
// vendor-neutral so a future GitLab/Bitbucket adapter swaps in without a
// rename. See .notes/tool-gh-api-coverage.spec.md.
//
// Token flow: --admin-token flag (or RANDO_ADMIN_TOKEN env var) supplies a
// fine-grained PAT minted for this run only. After the run completes, the
// operator deletes the PAT manually at
// https://github.com/settings/personal-access-tokens — GitHub has no REST
// endpoint for self-revoking a fine-grained PAT. The `setup` subcommand
// prints the cleanup link in its `finally` block so the reminder fires
// even on mid-run failure.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Command } from 'commander'
import type { Adapters } from '../config'
import { encryptSecretForGitHub } from '../crypto/sodium'
import { ProviderApiError } from '../domain/errors'
import type { GhAdminProvider, GhEnvironment, GhRepoSettings } from '../domain/gh-admin'
import type { Io } from '../output'
import { loadSetupConfig, type SetupConfig } from '../setup-config'

const DEFAULT_CONFIG_PATH = 'rando.config.json'
const RULESET_PATH = '.github/rulesets/main.json'
const CODEOWNERS_PATH = '.github/CODEOWNERS'

/** Default repo settings — mirror the existing rando-id/rando.id state. */
const DEFAULT_REPO_SETTINGS: GhRepoSettings = {
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  allow_auto_merge: true,
  delete_branch_on_merge: true,
}

export function versionControlCommand(adapters: Adapters, io: Io): Command {
  const { colors } = io
  const cmd = new Command('version-control')
    .alias('vc')
    .description(
      'Provision version-control hosting state (rulesets, environments, secrets, settings) ' +
        'via REST API. Uses an ephemeral admin PAT — see .notes/tool-gh-api-coverage.spec.md.',
    )

  cmd
    .command('setup')
    .description(
      'Run every subcommand in order. After the run, the operator deletes the admin PAT ' +
        'manually in the GitHub UI (GitHub has no self-revoke REST endpoint).',
    )
    .option('--admin-token <pat>', 'Ephemeral admin PAT (or set RANDO_ADMIN_TOKEN)')
    .option('--dry-run', 'Print what would happen without calling any APIs', false)
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .action(async (opts: { adminToken?: string; dryRun: boolean; config: string }) => {
      const cfg = loadSetupConfig(resolve(process.cwd(), opts.config))
      if (opts.dryRun) {
        io.stdout(colors.hint('dry-run: would apply'))
        io.stdout(`  • ruleset from ${RULESET_PATH}`)
        io.stdout(`  • repo settings on ${cfg.repo}`)
        io.stdout(`  • environments: staging, production`)
        io.stdout(`  • security toggles (Dependabot, secret scanning, private vuln reporting)`)
        io.stdout(`  • CODEOWNERS written to ${CODEOWNERS_PATH}`)
        return
      }
      // Resolve the token OUTSIDE the try/finally so the manual-revoke
      // reminder only fires when a PAT was actually accepted — a missing
      // token should not produce "go revoke a PAT" advice.
      const gh = adapters.ghAdmin({ token: resolveToken(opts.adminToken) })
      try {
        const who = await gh.whoami()
        io.stdout(`${colors.hint('→')} authenticated as ${colors.bold(who.login)}`)
        // Each step soft-fails: a 403 / 404 on one capability should not
        // block the rest of the run (CLAUDE.md soft-skip rule). Individual
        // helpers catch ProviderApiError, emit a stderr warning, and return.
        await applyRuleset(gh, cfg.repo, io)
        await applyRepoSettings(gh, cfg.repo, DEFAULT_REPO_SETTINGS, io)
        await applyEnvironments(gh, cfg.repo, io)
        await applySecurityToggles(gh, cfg.repo, io)
        await writeCodeowners(cfg, io)
      } finally {
        // No REST self-revoke (the `DELETE /personal-access-tokens/{id}`
        // endpoint is org-admin-only, not self-revoke; see #249 review).
        // Print the cleanup link so the operator deletes the PAT in the UI.
        io.stderr('')
        io.stderr(
          colors.warn(
            'next step: revoke the admin PAT manually at ' +
              'https://github.com/settings/personal-access-tokens',
          ),
        )
      }
    })

  cmd
    .command('ruleset')
    .description(`Create or update the ruleset declared in ${RULESET_PATH}.`)
    .option('--admin-token <pat>', 'Ephemeral admin PAT (or set RANDO_ADMIN_TOKEN)')
    .option('--dry-run', 'Print what would happen', false)
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .action(async (opts: { adminToken?: string; dryRun: boolean; config: string }) => {
      const cfg = loadSetupConfig(resolve(process.cwd(), opts.config))
      if (opts.dryRun) {
        io.stdout(colors.hint(`dry-run: would apply ruleset from ${RULESET_PATH} to ${cfg.repo}`))
        return
      }
      const gh = adapters.ghAdmin({ token: resolveToken(opts.adminToken) })
      await applyRuleset(gh, cfg.repo, io)
    })

  cmd
    .command('repo-settings')
    .description('Apply repo settings (squash-merge, auto-merge, delete-branch-on-merge).')
    .option('--admin-token <pat>', 'Ephemeral admin PAT (or set RANDO_ADMIN_TOKEN)')
    .option('--dry-run', 'Print what would happen', false)
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .action(async (opts: { adminToken?: string; dryRun: boolean; config: string }) => {
      const cfg = loadSetupConfig(resolve(process.cwd(), opts.config))
      if (opts.dryRun) {
        io.stdout(colors.hint(`dry-run: PATCH /repos/${cfg.repo}`))
        io.stdout(JSON.stringify(DEFAULT_REPO_SETTINGS, null, 2))
        return
      }
      const gh = adapters.ghAdmin({ token: resolveToken(opts.adminToken) })
      await applyRepoSettings(gh, cfg.repo, DEFAULT_REPO_SETTINGS, io)
    })

  cmd
    .command('environments')
    .description('Create/update Environments (staging, production).')
    .option('--admin-token <pat>', 'Ephemeral admin PAT (or set RANDO_ADMIN_TOKEN)')
    .option('--dry-run', 'Print what would happen', false)
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .action(async (opts: { adminToken?: string; dryRun: boolean; config: string }) => {
      const cfg = loadSetupConfig(resolve(process.cwd(), opts.config))
      if (opts.dryRun) {
        io.stdout(colors.hint(`dry-run: PUT /repos/${cfg.repo}/environments/{staging,production}`))
        return
      }
      const gh = adapters.ghAdmin({ token: resolveToken(opts.adminToken) })
      await applyEnvironments(gh, cfg.repo, io)
    })

  cmd
    .command('secret <name> [value]')
    .description(
      'Set one repo or environment secret. The value is read from stdin when ' +
        'omitted (recommended — keeps the plaintext out of shell history + ps). ' +
        'Encrypts via libsodium before push. Use --env <name> to target an ' +
        'environment instead of the repo.',
    )
    .option('--admin-token <pat>', 'Ephemeral admin PAT (or set RANDO_ADMIN_TOKEN)')
    .option('--env <name>', 'Environment name (omit for repo-level secret)')
    .option('--dry-run', 'Print what would happen', false)
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .action(
      async (
        name: string,
        value: string | undefined,
        opts: { adminToken?: string; env?: string; dryRun: boolean; config: string },
      ) => {
        const cfg = loadSetupConfig(resolve(process.cwd(), opts.config))
        const target = opts.env ? `environment ${opts.env}` : 'repo'
        if (opts.dryRun) {
          io.stdout(colors.hint(`dry-run: encrypt + PUT secret ${name} on ${target}`))
          return
        }
        // Prefer stdin so the plaintext value never lands in shell history
        // or `ps` output. Positional `value` stays supported for scripts
        // that already pipe through process env or other safe channels.
        const resolvedValue = value ?? (await readStdin())
        if (!resolvedValue) {
          throw new Error(
            'No secret value provided. Pipe via stdin (`echo $X | rando vc secret NAME`) ' +
              'or pass as a positional argument.',
          )
        }
        const gh = adapters.ghAdmin({ token: resolveToken(opts.adminToken) })
        const publicKey = opts.env
          ? await gh.getEnvironmentSecretPublicKey(cfg.repo, opts.env)
          : await gh.getRepoSecretPublicKey(cfg.repo)
        const encrypted = await encryptSecretForGitHub(resolvedValue, publicKey.key)
        if (opts.env) {
          await gh.setEnvironmentSecret(cfg.repo, opts.env, name, encrypted, publicKey.key_id)
        } else {
          await gh.setRepoSecret(cfg.repo, name, encrypted, publicKey.key_id)
        }
        io.stdout(`${colors.success('✓')} secret ${colors.bold(name)} set on ${target}`)
      },
    )

  cmd
    .command('security')
    .description(
      'Enable repo-level security toggles (Dependabot alerts + security updates, ' +
        'secret scanning + push protection, private vulnerability reporting). ' +
        'Use --include-org-2fa to additionally require 2FA across the org ' +
        '(org-admin scope, destructive — boots members without 2FA).',
    )
    .option('--admin-token <pat>', 'Ephemeral admin PAT (or set RANDO_ADMIN_TOKEN)')
    .option('--include-org-2fa', 'Also require 2FA across the org (DESTRUCTIVE)', false)
    .option('--dry-run', 'Print what would happen', false)
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .action(
      async (opts: {
        adminToken?: string
        includeOrg2fa: boolean
        dryRun: boolean
        config: string
      }) => {
        const cfg = loadSetupConfig(resolve(process.cwd(), opts.config))
        if (opts.dryRun) {
          io.stdout(colors.hint(`dry-run: would enable on ${cfg.repo}`))
          io.stdout('  • vulnerability alerts (Dependabot)')
          io.stdout('  • automated security fixes (Dependabot)')
          io.stdout('  • secret scanning + push protection')
          io.stdout('  • private vulnerability reporting')
          if (opts.includeOrg2fa) {
            const org = cfg.repo.split('/')[0]
            io.stdout(`  • org-level 2FA requirement on ${colors.bold(org!)} (DESTRUCTIVE)`)
          }
          return
        }
        const gh = adapters.ghAdmin({ token: resolveToken(opts.adminToken) })
        await applySecurityToggles(gh, cfg.repo, io)
        if (opts.includeOrg2fa) {
          await applyOrgTwoFactor(gh, cfg.repo, io)
        }
      },
    )

  cmd
    .command('codeowners')
    .description('Write .github/CODEOWNERS from rando.config.json (local file, no token needed).')
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--dry-run', 'Print what would be written', false)
    .action(async (opts: { config: string; dryRun: boolean }) => {
      const cfg = loadSetupConfig(resolve(process.cwd(), opts.config))
      if (opts.dryRun) {
        io.stdout(colors.hint(`dry-run: would write ${CODEOWNERS_PATH}`))
        io.stdout(renderCodeowners(cfg))
        return
      }
      await writeCodeowners(cfg, io)
    })

  return cmd
}

/**
 * Read the secret value from stdin when available. Returns empty string when
 * stdin is a TTY (interactive prompt — no piped input) so the caller can
 * surface a clear "provide a value" error instead of hanging on read.
 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  let buf = ''
  process.stdin.setEncoding('utf-8')
  for await (const chunk of process.stdin) buf += chunk
  // Trim trailing newline that `echo` and most pipes add — secrets rarely
  // need a literal trailing newline, and operators get bitten when they do.
  return buf.replace(/\n$/, '')
}

function resolveToken(flag?: string): string {
  const token = flag ?? process.env.RANDO_ADMIN_TOKEN
  if (!token) {
    throw new Error(
      'No admin PAT provided. Pass --admin-token <pat> or set RANDO_ADMIN_TOKEN. ' +
        'Mint a fine-grained PAT in GitHub UI scoped to admin operations; revoke it after this run.',
    )
  }
  return token
}

async function applyRuleset(gh: GhAdminProvider, repo: string, io: Io): Promise<void> {
  const raw = await readFile(resolve(process.cwd(), RULESET_PATH), 'utf-8').catch(() => null)
  if (!raw) {
    io.stderr(io.colors.warn(`ruleset: skipped — ${RULESET_PATH} not found`))
    return
  }
  // Parse separately so a malformed-JSON error produces a clearer message
  // than a generic SyntaxError stack trace, and so it soft-fails (matches
  // the missing-file branch above + CLAUDE.md soft-skip rule).
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    io.stderr(io.colors.warn(`ruleset: skipped — invalid JSON in ${RULESET_PATH}: ${detail}`))
    return
  }
  const desiredName = (payload.name as string | undefined) ?? 'main'
  try {
    const existing = await gh.listRulesets(repo)
    const match = existing.find((r) => r.name === desiredName)
    if (match) {
      await gh.updateRuleset(repo, match.id, payload)
      io.stdout(`${io.colors.success('✓')} ruleset updated: ${desiredName} (#${match.id})`)
    } else {
      const created = await gh.createRuleset(repo, payload)
      io.stdout(`${io.colors.success('✓')} ruleset created: ${desiredName} (#${created.id})`)
    }
  } catch (err) {
    if (err instanceof ProviderApiError) {
      io.stderr(io.colors.warn(`ruleset: ${err.message}`))
      return
    }
    throw err
  }
}

async function applyRepoSettings(
  gh: GhAdminProvider,
  repo: string,
  settings: GhRepoSettings,
  io: Io,
): Promise<void> {
  try {
    await gh.updateRepoSettings(repo, settings)
    io.stdout(`${io.colors.success('✓')} repo settings applied`)
  } catch (err) {
    if (err instanceof ProviderApiError) {
      io.stderr(io.colors.warn(`repo settings: ${err.message}`))
      return
    }
    throw err
  }
}

async function applyEnvironments(gh: GhAdminProvider, repo: string, io: Io): Promise<void> {
  const environments: GhEnvironment[] = [
    { name: 'staging' },
    {
      name: 'production',
      // Reviewer wiring is operator-driven for now; leave the array empty so
      // the env gets created without enforcement. Operator adds reviewers
      // either via `vc setup` re-run with reviewers in config (Phase 2) or
      // directly in the GH UI.
    },
  ]
  for (const env of environments) {
    try {
      await gh.upsertEnvironment(repo, env)
      io.stdout(`${io.colors.success('✓')} environment upserted: ${env.name}`)
    } catch (err) {
      if (err instanceof ProviderApiError) {
        io.stderr(io.colors.warn(`environment ${env.name}: ${err.message}`))
        continue
      }
      throw err
    }
  }
}

async function applySecurityToggles(gh: GhAdminProvider, repo: string, io: Io): Promise<void> {
  // Each toggle is independent — a 403 on one (e.g. private vuln reporting
  // needs the repo to be public or have Advanced Security on) shouldn't
  // block the rest. Soft-fail per CLAUDE.md.
  const steps: Array<{ label: string; run: () => Promise<void> }> = [
    { label: 'vulnerability alerts', run: () => gh.enableVulnerabilityAlerts(repo) },
    { label: 'automated security fixes', run: () => gh.enableAutomatedSecurityFixes(repo) },
    { label: 'secret scanning + push protection', run: () => gh.enableSecretScanning(repo) },
    {
      label: 'private vulnerability reporting',
      run: () => gh.enablePrivateVulnerabilityReporting(repo),
    },
  ]
  for (const step of steps) {
    try {
      await step.run()
      io.stdout(`${io.colors.success('✓')} ${step.label} enabled`)
    } catch (err) {
      if (err instanceof ProviderApiError) {
        io.stderr(io.colors.warn(`${step.label}: ${err.message}`))
        continue
      }
      throw err
    }
  }
}

async function applyOrgTwoFactor(gh: GhAdminProvider, repo: string, io: Io): Promise<void> {
  const org = repo.split('/')[0]
  if (!org) {
    io.stderr(io.colors.warn(`org 2fa: cannot derive org from repo "${repo}" — skipped`))
    return
  }
  try {
    await gh.enableOrgTwoFactorRequirement(org)
    io.stdout(`${io.colors.success('✓')} org 2FA requirement enabled on ${org}`)
  } catch (err) {
    if (err instanceof ProviderApiError) {
      io.stderr(io.colors.warn(`org 2fa (${org}): ${err.message}`))
      return
    }
    throw err
  }
}

async function writeCodeowners(cfg: SetupConfig, io: Io): Promise<void> {
  const content = renderCodeowners(cfg)
  const outPath = resolve(process.cwd(), CODEOWNERS_PATH)
  // Make `.github/` if it doesn't exist — the command runs on fresh repos
  // where the directory hasn't been created yet.
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, content, 'utf-8')
  io.stdout(`${io.colors.success('✓')} ${CODEOWNERS_PATH} written`)
}

function renderCodeowners(cfg: SetupConfig): string {
  // Prefer the explicit `codeowners` list from config (real GitHub logins).
  // Fall back to the repo owner — fine for personal repos, but for orgs the
  // owner is the org name (e.g. `@rando-id`) which mentions the whole org
  // rather than specific humans. Set `codeowners: [...]` to fix that.
  const owners =
    cfg.codeowners && cfg.codeowners.length > 0 ? cfg.codeowners : [cfg.repo.split('/')[0]!]
  const ownerLine = owners.map((o) => `@${o}`).join(' ')
  return [
    '# Generated by `rando vc codeowners` — do not edit by hand.',
    '# Source: rando.config.json (codeowners field; falls back to repo owner).',
    '',
    `* ${ownerLine}`,
    '',
  ].join('\n')
}
