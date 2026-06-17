// Clerk CLI adapter — shells out to `clerk api` (the official CLI's
// authenticated raw-API subcommand). We use the CLI rather than calling
// the Backend API directly so:
//   - auth handling is one flag (`--secret-key`) rather than wiring
//     the Bearer header + base URL ourselves
//   - the `clerk` binary is already what an operator runs by hand for
//     debugging, so behavior matches
//   - mutating requests need `--yes` to skip the confirm prompt; we
//     pass it unconditionally because every call we make is intended.
//
// The secret key determines which Clerk instance (Development vs
// Production) we operate on, so a single ClerkCliAdapter instance is
// scoped to one environment. The command layer constructs a new
// adapter per --env.

import { spawnSync } from 'node:child_process'
import { ProviderApiError } from '../domain/errors'
import type { ClerkCreateUserInput, ClerkProvider, ClerkUser } from '../domain/clerk'

export interface ClerkCliOptions {
  /** Override the spawn function in tests. */
  spawn?: typeof spawnSync
  /**
   * Clerk Backend API secret key (sk_test_* or sk_live_*) — passed as
   * --secret-key on every call.
   */
  secretKey: string
  /**
   * Command used to invoke the CLI. Defaults to `npx clerk@latest`.
   * Pinned via a single string so the invocation is identical to what
   * the user would run themselves.
   */
  invocation?: string[]
}

interface ClerkResult {
  ok: boolean
  stdout: string
  stderr: string
}

export class ClerkCliAdapter implements ClerkProvider {
  private readonly spawnImpl: typeof spawnSync
  private readonly secretKey: string
  private readonly invocation: string[]

  constructor(opts: ClerkCliOptions) {
    this.spawnImpl = opts.spawn ?? spawnSync
    this.secretKey = opts.secretKey
    this.invocation = opts.invocation ?? ['npx', 'clerk@latest']
  }

  async whoami(): Promise<{ count: number }> {
    const body = await this.api<{ total_count: number }>('GET', '/users/count')
    return { count: body.total_count }
  }

  async ensureSvixApp(): Promise<{ alreadyExists: boolean }> {
    const result = this.spawn(['api', '-X', 'POST', '/webhooks/svix'])
    if (result.ok) {
      return { alreadyExists: false }
    }
    // Clerk returns `you_already_have_a_svix_app` (or similar — the
    // error JSON contains the phrase) when the Svix app exists. Treat
    // that as a successful no-op so the orchestrator path is idempotent.
    const lower = (result.stdout + result.stderr).toLowerCase()
    if (lower.includes('already') || lower.includes('exists')) {
      return { alreadyExists: true }
    }
    throw this.toApiError('POST /webhooks/svix', result)
  }

  async getSvixDashboardUrl(): Promise<{ url: string }> {
    const body = await this.api<{ url?: string; svix_url?: string }>('POST', '/webhooks/svix_url')
    const url = body.url ?? body.svix_url
    if (!url) {
      throw new ProviderApiError(
        'clerk',
        500,
        'no url returned from /webhooks/svix_url',
        'Clerk returned 200 but the response body had no `url` field',
      )
    }
    return { url }
  }

  async createUser(input: ClerkCreateUserInput): Promise<ClerkUser> {
    const body = await this.api<{
      id: string
      email_addresses: { email_address: string }[]
    }>('POST', '/users', {
      email_address: [input.email],
      password: input.password,
      ...(input.firstName ? { first_name: input.firstName } : {}),
      ...(input.lastName ? { last_name: input.lastName } : {}),
    })
    const email = body.email_addresses[0]?.email_address ?? input.email
    return { id: body.id, email }
  }

  // --- internals ----------------------------------------------------

  private async api<T>(method: string, path: string, payload?: unknown): Promise<T> {
    const args = ['api', '-X', method, path]
    if (payload !== undefined) {
      args.push('-d', JSON.stringify(payload))
    }
    const result = this.spawn(args)
    if (!result.ok) {
      throw this.toApiError(`${method} ${path}`, result)
    }
    if (!result.stdout.trim()) {
      // Some Clerk endpoints (DELETEs, certain POSTs) return empty
      // body on success. Callers that care will mistype the generic —
      // not our problem; we don't double-parse.
      return {} as T
    }
    try {
      return JSON.parse(result.stdout) as T
    } catch (err) {
      throw new ProviderApiError(
        'clerk',
        500,
        `couldn't parse clerk api response as JSON`,
        `${err instanceof Error ? err.message : String(err)}\n--- stdout ---\n${result.stdout}`,
      )
    }
  }

  private spawn(args: string[]): ClerkResult {
    const fullArgs = [...this.invocation.slice(1), ...args, '--secret-key', this.secretKey, '--yes']
    const out = this.spawnImpl(this.invocation[0]!, fullArgs, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return {
      ok: out.status === 0,
      stdout: out.stdout ?? '',
      stderr: out.stderr ?? '',
    }
  }

  private toApiError(operation: string, result: ClerkResult): ProviderApiError {
    // Clerk's CLI writes errors as JSON to stdout (not stderr). Try to
    // surface the `errors[].message` so the user sees a real reason,
    // not a Node-spawn dump.
    let detail = result.stderr || result.stdout || 'no output'
    try {
      const parsed = JSON.parse(result.stdout) as {
        errors?: { message?: string; long_message?: string }[]
        error?: { message?: string }
      }
      const message =
        parsed.errors?.[0]?.long_message ?? parsed.errors?.[0]?.message ?? parsed.error?.message
      if (message) detail = message
    } catch {
      // Not JSON — keep the raw output.
    }
    return new ProviderApiError('clerk', 0, `${operation} failed`, detail)
  }
}
