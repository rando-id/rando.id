// 1Password CLI adapter — shells out to `op` (https://developer.1password.com/docs/cli).
//
// Strategy:
//   - `op whoami --format=json`            → identity check
//   - `op read <op://...>`                 → resolve a single reference
//   - `op item edit <name> <field>=<v>`    → update existing item
//   - `op item create --title=<name>`      → fall back to create
//
// We deliberately don't use the 1Password SDK or service accounts.
// The CLI is what every developer already has installed (Brewfile
// includes `1password-cli`), uses the desktop app's biometric unlock,
// and doesn't introduce a bootstrap-token problem.

import { spawnSync } from 'node:child_process'
import { ProviderApiError } from '../domain/errors'
import type { SecretsAccount, SecretsIdentity, SecretsProvider } from '../domain/secrets'

export interface OpCliOptions {
  /** Override the spawn function in tests. Defaults to node:child_process spawnSync. */
  spawn?: typeof spawnSync
  /** Path to the op binary (defaults to "op" — found via PATH). */
  binary?: string
  /**
   * 1Password account UUID. Passed as --account on every op call so
   * the integration targets the right account regardless of the
   * user's default. Found via `op account list`.
   */
  account?: string
}

interface OpResult {
  ok: boolean
  stdout: string
  stderr: string
}

export class OpCliProvider implements SecretsProvider {
  private readonly spawnImpl: typeof spawnSync
  private readonly binary: string
  private readonly account: string | undefined

  constructor(opts: OpCliOptions = {}) {
    this.spawnImpl = opts.spawn ?? spawnSync
    this.binary = opts.binary ?? 'op'
    this.account = opts.account
  }

  async whoami(): Promise<SecretsIdentity> {
    const result = this.run(['whoami', '--format=json'])
    if (!result.ok) {
      throw new ProviderApiError('1password', 401, result.stderr || 'not signed in to op CLI')
    }
    // The op CLI's whoami JSON shape varies by version + auth mode:
    //   - Personal sign-in:        { url, user_email, user_uuid, account_uuid }
    //   - Newer versions:          { url, email, user_id, account_uuid }
    //   - Service account auth:    { url, account_uuid } (no email!)
    // Fall through identity candidates so we never display "<unknown>"
    // when there's a useful label available.
    const parsed = JSON.parse(result.stdout) as {
      url?: string
      user_email?: string
      email?: string
      user_uuid?: string
      account_uuid?: string
    }
    const account =
      parsed.user_email ?? parsed.email ?? parsed.user_uuid ?? parsed.account_uuid ?? '<unknown>'
    return {
      account,
      url: parsed.url ?? '<unknown>',
    }
  }

  async listAccounts(): Promise<SecretsAccount[]> {
    // `op account list` does NOT need --account (it's listing every
    // account this CLI knows about), and does NOT need an active
    // signed-in session — it reads the CLI's local config.
    // Intentionally bypass our `run()` helper so we can skip the
    // --account injection that whoami/read/write all do.
    const result = this.spawnImpl(this.binary, ['account', 'list', '--format=json'], {
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    if (result.error) {
      throw new ProviderApiError('1password', 500, result.error.message)
    }
    if (result.status !== 0) {
      const stderr = (result.stderr ?? '').trim()
      throw new ProviderApiError('1password', 500, stderr || 'op account list failed')
    }
    const stdout = (result.stdout ?? '').trim()
    // Empty list is a valid result — user hasn't run `op signin` yet.
    if (!stdout) return []
    const parsed = JSON.parse(stdout) as Array<{
      url?: string
      email?: string
      user_uuid?: string
      account_uuid?: string
    }>
    return parsed.map((a) => ({
      accountUuid: a.account_uuid ?? '',
      userUuid: a.user_uuid ?? '',
      url: a.url ?? '',
      email: a.email ?? '',
    }))
  }

  async read(reference: string): Promise<string> {
    const result = this.run(['read', reference, '--no-newline'])
    if (!result.ok) {
      throw new ProviderApiError('1password', 404, result.stderr || `op read ${reference} failed`)
    }
    return result.stdout
  }

  async write(input: { vault: string; item: string; field: string; value: string }): Promise<void> {
    // `op item edit` returns non-zero when the item doesn't exist;
    // probe first so we can fall back to create. Using `op item get`
    // for the probe is more reliable than parsing edit's stderr.
    const probe = this.run(['item', 'get', input.item, `--vault=${input.vault}`, '--format=json'])
    if (probe.ok) {
      // Item exists — update the field.
      const result = this.run([
        'item',
        'edit',
        input.item,
        `--vault=${input.vault}`,
        `${input.field}=${input.value}`,
      ])
      if (!result.ok) {
        throw new ProviderApiError(
          '1password',
          500,
          result.stderr || `op item edit ${input.item} failed`,
        )
      }
      return
    }
    // Item missing — create.
    const result = this.run([
      'item',
      'create',
      `--title=${input.item}`,
      `--vault=${input.vault}`,
      '--category=API Credential',
      `${input.field}=${input.value}`,
    ])
    if (!result.ok) {
      throw new ProviderApiError(
        '1password',
        500,
        result.stderr || `op item create ${input.item} failed`,
      )
    }
  }

  /**
   * Thin wrapper around the configured spawn implementation. Captures
   * stdout/stderr as utf-8 strings and surfaces a uniform OpResult so
   * callers don't repeat the exit-code + decoding boilerplate.
   *
   * Prepends `--account <UUID>` when an account is configured so every
   * op call hits the same account, even when the user has multiple
   * accounts signed in (work + personal). `--account` belongs before
   * the subcommand verb per the op CLI's arg parser.
   */
  private run(args: string[]): OpResult {
    const fullArgs = this.account ? ['--account', this.account, ...args] : args
    // stdio shape matters here for biometric unlock: the 1Password
    // CLI checks whether stdin is a TTY to decide if it can prompt
    // for biometric. Default spawnSync stdio is ['pipe','pipe','pipe']
    // — no TTY — and op returns "not signed in" instead of firing the
    // desktop biometric dialog. Inheriting stdin gives op the
    // TTY-attached signal; we keep stdout/stderr piped so we can
    // still parse output. In non-interactive contexts (CI, scripts)
    // stdin is whatever the parent inherited (often /dev/null or a
    // pipe), so op sees "no TTY" and behaves the same as before.
    const out = this.spawnImpl(this.binary, fullArgs, {
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    if (out.error) {
      return { ok: false, stdout: '', stderr: out.error.message }
    }
    return {
      ok: out.status === 0,
      stdout: (out.stdout ?? '').trim(),
      stderr: (out.stderr ?? '').trim(),
    }
  }
}
