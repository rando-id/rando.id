// `rando version-control` (alias `vc`) — provision version-control hosting
// state (rulesets, environments, secrets, repo settings) via REST API.
// Today the only backend is GitHub; the command surface stays
// vendor-neutral so a future GitLab/Bitbucket adapter swaps in without a
// rename. See .notes/tool-gh-api-coverage.spec.md.
//
// Token flow: --admin-token flag (or RANDO_ADMIN_TOKEN env var) supplies a
// fine-grained PAT minted for this run only. `setup` revokes it at the end
// if --token-id is provided; individual subcommands leave revocation to
// the operator (use `revoke-token`).

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
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
        io.stdout(`  • CODEOWNERS written to ${CODEOWNERS_PATH}`)
        return
      }
      const gh = adapters.ghAdmin({ token: resolveToken(opts.adminToken) })
      const who = await gh.whoami()
      io.stdout(`${colors.hint('→')} authenticated as ${colors.bold(who.login)}`)
      await applyRuleset(gh, cfg.repo, io)
      await applyRepoSettings(gh, cfg.repo, DEFAULT_REPO_SETTINGS, io)
      await applyEnvironments(gh, cfg.repo, io)
      await writeCodeowners(cfg, io)
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
    .command('secret <name> <value>')
    .description(
      'Set one repo or environment secret. Encrypts via libsodium before push. ' +
        'Use --env <name> to target an environment instead of the repo.',
    )
    .option('--admin-token <pat>', 'Ephemeral admin PAT (or set RANDO_ADMIN_TOKEN)')
    .option('--env <name>', 'Environment name (omit for repo-level secret)')
    .option('--dry-run', 'Print what would happen', false)
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .action(
      async (
        name: string,
        value: string,
        opts: { adminToken?: string; env?: string; dryRun: boolean; config: string },
      ) => {
        const cfg = loadSetupConfig(resolve(process.cwd(), opts.config))
        const target = opts.env ? `environment ${opts.env}` : 'repo'
        if (opts.dryRun) {
          io.stdout(colors.hint(`dry-run: encrypt + PUT secret ${name} on ${target}`))
          return
        }
        const gh = adapters.ghAdmin({ token: resolveToken(opts.adminToken) })
        const publicKey = opts.env
          ? await gh.getEnvironmentSecretPublicKey(cfg.repo, opts.env)
          : await gh.getRepoSecretPublicKey(cfg.repo)
        const encrypted = await encryptSecretForGitHub(value, publicKey.key)
        if (opts.env) {
          await gh.setEnvironmentSecret(cfg.repo, opts.env, name, encrypted, publicKey.key_id)
        } else {
          await gh.setRepoSecret(cfg.repo, name, encrypted, publicKey.key_id)
        }
        io.stdout(`${colors.success('✓')} secret ${colors.bold(name)} set on ${target}`)
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
  const payload = JSON.parse(raw) as Record<string, unknown>
  const desiredName = (payload.name as string | undefined) ?? 'main'
  const existing = await gh.listRulesets(repo)
  const match = existing.find((r) => r.name === desiredName)
  if (match) {
    await gh.updateRuleset(repo, match.id, payload)
    io.stdout(`${io.colors.success('✓')} ruleset updated: ${desiredName} (#${match.id})`)
  } else {
    const created = await gh.createRuleset(repo, payload)
    io.stdout(`${io.colors.success('✓')} ruleset created: ${desiredName} (#${created.id})`)
  }
}

async function applyRepoSettings(
  gh: GhAdminProvider,
  repo: string,
  settings: GhRepoSettings,
  io: Io,
): Promise<void> {
  await gh.updateRepoSettings(repo, settings)
  io.stdout(`${io.colors.success('✓')} repo settings applied`)
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

async function writeCodeowners(cfg: SetupConfig, io: Io): Promise<void> {
  const content = renderCodeowners(cfg)
  await writeFile(resolve(process.cwd(), CODEOWNERS_PATH), content, 'utf-8')
  io.stdout(`${io.colors.success('✓')} ${CODEOWNERS_PATH} written`)
}

function renderCodeowners(cfg: SetupConfig): string {
  // Minimal CODEOWNERS — repo owner gets default ownership of everything.
  // Per-path rules are a follow-up once we have a maintainers list in
  // rando.config.json.
  const owner = cfg.repo.split('/')[0]
  return [
    '# Generated by `rando vc codeowners` — do not edit by hand.',
    '# Source: rando.config.json (repo + future maintainers field).',
    '',
    `* @${owner}`,
    '',
  ].join('\n')
}
