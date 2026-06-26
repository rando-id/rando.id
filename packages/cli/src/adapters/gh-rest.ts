// GitHub admin adapter — direct REST against api.github.com using a
// caller-supplied PAT. Separate from `gh-cli.ts` so the ephemeral admin
// PAT lifecycle (create → use → revoke per run) doesn't have to fight
// with `gh`'s persistent keychain auth.

import { ProviderApiError } from '../domain/errors'
import type {
  GhAdminProvider,
  GhEnvironment,
  GhPublicKey,
  GhRepoSettings,
  GhRuleset,
} from '../domain/gh-admin'

export interface GhRestOptions {
  /** Ephemeral admin PAT — passed via --admin-token, never persisted. */
  token: string
  /** Override fetch in tests. */
  fetch?: typeof fetch
  /** Override API base (default api.github.com). */
  baseUrl?: string
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Expect 204 (no body). Skip JSON parse when true. */
  expectNoContent?: boolean
}

export class GhRestProvider implements GhAdminProvider {
  private readonly token: string
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string

  constructor(opts: GhRestOptions) {
    this.token = opts.token
    this.fetchImpl = opts.fetch ?? globalThis.fetch
    this.baseUrl = opts.baseUrl ?? 'https://api.github.com'
  }

  async whoami(): Promise<{ login: string }> {
    const data = await this.request<{ login: string }>('/user')
    return { login: data.login }
  }

  async listRulesets(repo: string): Promise<GhRuleset[]> {
    return this.request<GhRuleset[]>(`/repos/${repo}/rulesets`)
  }

  async createRuleset(repo: string, payload: Record<string, unknown>): Promise<GhRuleset> {
    return this.request<GhRuleset>(`/repos/${repo}/rulesets`, {
      method: 'POST',
      body: payload,
    })
  }

  async updateRuleset(
    repo: string,
    id: number,
    payload: Record<string, unknown>,
  ): Promise<GhRuleset> {
    return this.request<GhRuleset>(`/repos/${repo}/rulesets/${id}`, {
      method: 'PUT',
      body: payload,
    })
  }

  async upsertEnvironment(repo: string, env: GhEnvironment): Promise<void> {
    // PUT is idempotent — creates if missing, updates if present. Wait-timer
    // and reviewers go in the same payload.
    const body: Record<string, unknown> = {}
    if (env.wait_timer !== undefined) body.wait_timer = env.wait_timer
    if (env.prevent_self_review !== undefined) body.prevent_self_review = env.prevent_self_review
    if (env.required_reviewers !== undefined) {
      body.reviewers = env.required_reviewers.map((r) => ({
        type: r.type,
        // The API takes numeric id for User/Team; the spec stores logins for
        // readability. Translation step lives in the command — the adapter
        // takes whatever shape the caller hands it.
        ...(typeof r.login === 'number' ? { id: r.login } : { login: r.login }),
      }))
    }
    await this.request<void>(`/repos/${repo}/environments/${env.name}`, {
      method: 'PUT',
      body,
      expectNoContent: false, // returns 200 with the env body
    })
  }

  async updateRepoSettings(repo: string, settings: GhRepoSettings): Promise<void> {
    await this.request<void>(`/repos/${repo}`, {
      method: 'PATCH',
      body: settings,
    })
  }

  async getRepoSecretPublicKey(repo: string): Promise<GhPublicKey> {
    return this.request<GhPublicKey>(`/repos/${repo}/actions/secrets/public-key`)
  }

  async getEnvironmentSecretPublicKey(repo: string, environment: string): Promise<GhPublicKey> {
    return this.request<GhPublicKey>(
      `/repos/${repo}/environments/${environment}/secrets/public-key`,
    )
  }

  async setRepoSecret(
    repo: string,
    name: string,
    encryptedValue: string,
    keyId: string,
  ): Promise<void> {
    await this.request<void>(`/repos/${repo}/actions/secrets/${name}`, {
      method: 'PUT',
      body: { encrypted_value: encryptedValue, key_id: keyId },
      expectNoContent: true,
    })
  }

  async setEnvironmentSecret(
    repo: string,
    environment: string,
    name: string,
    encryptedValue: string,
    keyId: string,
  ): Promise<void> {
    await this.request<void>(`/repos/${repo}/environments/${environment}/secrets/${name}`, {
      method: 'PUT',
      body: { encrypted_value: encryptedValue, key_id: keyId },
      expectNoContent: true,
    })
  }

  async revokeAdminToken(tokenId: number): Promise<void> {
    // Fine-grained PAT self-revoke. The endpoint is on the user's PAT list;
    // requires the token being deleted to BE the token making the call (or
    // an explicit admin override). Either way, the result is the PAT can
    // no longer authenticate.
    await this.request<void>(`/personal-access-tokens/${tokenId}`, {
      method: 'DELETE',
      expectNoContent: true,
    })
  }

  private async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${this.token}`,
      'x-github-api-version': '2022-11-28',
    }
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
    }
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(opts.body)
    }
    const res = await this.fetchImpl(url, init)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderApiError('github', res.status, body)
    }
    if (opts.expectNoContent || res.status === 204) {
      return undefined as T
    }
    // 200 with an empty body still happens on some endpoints; tolerate.
    const text = await res.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  }
}
