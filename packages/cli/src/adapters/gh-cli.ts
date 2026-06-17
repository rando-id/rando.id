// GitHub CLI adapter — shells out to `gh` for repo admin operations
// (setting Actions secrets, currently).
//
// `gh` handles its own auth: a token cached in the macOS keychain or
// the `GH_TOKEN` env var. We don't manage that — `gh auth login` /
// `gh auth status` are the user's responsibility. Our `whoami` just
// verifies the current auth is usable.

import { spawnSync } from 'node:child_process'
import { ProviderApiError } from '../domain/errors'
import type { GhProvider } from '../domain/gh'

export interface GhCliOptions {
  /** Override the spawn function in tests. */
  spawn?: typeof spawnSync
  /** Path to the gh binary (defaults to "gh"). */
  binary?: string
}

interface GhResult {
  ok: boolean
  stdout: string
  stderr: string
}

export class GhCliProvider implements GhProvider {
  private readonly spawnImpl: typeof spawnSync
  private readonly binary: string

  constructor(opts: GhCliOptions = {}) {
    this.spawnImpl = opts.spawn ?? spawnSync
    this.binary = opts.binary ?? 'gh'
  }

  async whoami(): Promise<{ login: string }> {
    const result = this.run(['api', 'user', '--jq', '.login'])
    if (!result.ok) {
      throw new ProviderApiError(
        'github',
        401,
        result.stderr || 'gh CLI not authenticated — run `gh auth login`',
      )
    }
    return { login: result.stdout }
  }

  async setRepoSecret(input: { repo: string; name: string; value: string }): Promise<void> {
    // `gh secret set <NAME> --repo <repo> --body <value>` would expose
    // the value in argv and ps output. Pipe via stdin instead — `gh`
    // reads the value from stdin when --body isn't passed.
    const result = this.runWithStdin(
      ['secret', 'set', input.name, '--repo', input.repo],
      input.value,
    )
    if (!result.ok) {
      throw new ProviderApiError(
        'github',
        result.stderr.includes('authentication') ? 401 : 500,
        result.stderr || `gh secret set ${input.name} failed`,
      )
    }
  }

  private run(args: string[]): GhResult {
    const out = this.spawnImpl(this.binary, args, { encoding: 'utf-8' })
    if (out.error) {
      return { ok: false, stdout: '', stderr: out.error.message }
    }
    return {
      ok: out.status === 0,
      stdout: (out.stdout ?? '').trim(),
      stderr: (out.stderr ?? '').trim(),
    }
  }

  private runWithStdin(args: string[], input: string): GhResult {
    const out = this.spawnImpl(this.binary, args, {
      encoding: 'utf-8',
      input,
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
