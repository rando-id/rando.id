// Shell-out adapter for the Vercel CLI. We only use it for the
// marketplace-storage operations the REST API doesn't expose (#78).
//
// `vercel install <integration>` is the documented entry point per
// https://vercel.com/docs/marketplace-storage. Authentication uses
// whichever `vercel login` session the user has (or VERCEL_TOKEN env).

import { spawnSync } from 'node:child_process'
import { ProviderApiError } from '../domain/errors'
import type { VercelCliProvisioner } from '../domain/vercel-cli'

export interface VercelCliOptions {
  /** Override the spawn function in tests. */
  spawn?: typeof spawnSync
  /** Path to the vercel binary (defaults to "vercel"). */
  binary?: string
  /** Vercel API token — passed as --token on every invocation. */
  token?: string
  /**
   * Vercel team slug or team ID (e.g. "rando-id"). Passed as --scope
   * so commands target the right team instead of the token-owner's
   * personal account.
   */
  scope?: string
}

export class VercelCliAdapter implements VercelCliProvisioner {
  private readonly spawnImpl: typeof spawnSync
  private readonly binary: string
  private readonly token: string | undefined
  private readonly scope: string | undefined

  constructor(opts: VercelCliOptions = {}) {
    this.spawnImpl = opts.spawn ?? spawnSync
    this.binary = opts.binary ?? 'vercel'
    this.token = opts.token
    this.scope = opts.scope
  }

  async installNeon(input: {
    name: string
    plan: string
    envs: ReadonlyArray<'production' | 'preview' | 'development'>
  }): Promise<void> {
    const args = [
      'install',
      'neon',
      '--name',
      input.name,
      '--plan',
      input.plan,
      ...input.envs.flatMap((e) => ['-e', e]),
      // Pass --token explicitly when we have one rather than relying
      // on VERCEL_TOKEN env-var inheritance — some `vercel` versions
      // ignore the env var and demand `vercel login` or `--token`.
      ...(this.token ? ['--token', this.token] : []),
      // Target the right team scope — tokens default to the owner's
      // personal account otherwise, which fails for team-owned
      // marketplace installs.
      ...(this.scope ? ['--scope', this.scope] : []),
    ]
    const result = this.spawnImpl(this.binary, args, {
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    if (result.error) {
      throw new ProviderApiError(
        'vercel',
        0,
        `spawn ${this.binary} ${args.join(' ')} failed: ${result.error.message}`,
      )
    }
    if (result.status !== 0) {
      const stderr = (result.stderr ?? '').trim()
      const stdout = (result.stdout ?? '').trim()
      throw new ProviderApiError(
        'vercel',
        result.status ?? 1,
        `vercel install neon failed: ${stderr || stdout || '(no output)'}`,
      )
    }
  }
}
