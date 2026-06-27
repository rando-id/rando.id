import { describe, expect, it } from 'vitest'
import { GhRestProvider } from '../adapters/gh-rest'
import { ProviderApiError } from '../domain/errors'
import { stubFetch } from './helpers'

const REPO = 'rando-id/rando.id'
const TOKEN = 'gh_pat_test'

function makeProvider(responses: Parameters<typeof stubFetch>[0]) {
  const { fetch, calls } = stubFetch(responses)
  const provider = new GhRestProvider({ token: TOKEN, fetch })
  return { provider, calls }
}

describe('GhRestProvider', () => {
  it('whoami → GET /user with bearer token', async () => {
    const { provider, calls } = makeProvider([{ status: 200, body: { login: 'iamnewton' } }])
    const result = await provider.whoami()
    expect(result).toEqual({ login: 'iamnewton' })
    expect(calls[0]?.url).toBe('https://api.github.com/user')
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.headers?.authorization).toBe(`Bearer ${TOKEN}`)
    expect(calls[0]?.headers?.['x-github-api-version']).toBe('2022-11-28')
  })

  it('throws ProviderApiError on non-ok response', async () => {
    const { provider } = makeProvider([{ status: 401, text: 'bad creds' }])
    await expect(provider.whoami()).rejects.toBeInstanceOf(ProviderApiError)
  })

  it('listRulesets → GET /repos/{repo}/rulesets', async () => {
    const body = [{ id: 1, name: 'main', enforcement: 'active' }]
    const { provider, calls } = makeProvider([{ status: 200, body }])
    const result = await provider.listRulesets(REPO)
    expect(result).toEqual(body)
    expect(calls[0]?.url).toBe(`https://api.github.com/repos/${REPO}/rulesets`)
  })

  it('createRuleset → POST with body', async () => {
    const { provider, calls } = makeProvider([
      { status: 201, body: { id: 99, name: 'main', enforcement: 'active' } },
    ])
    await provider.createRuleset(REPO, { name: 'main', target: 'branch' })
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe(`https://api.github.com/repos/${REPO}/rulesets`)
    expect(calls[0]?.body).toEqual({ name: 'main', target: 'branch' })
  })

  it('updateRuleset → PUT to ruleset id', async () => {
    const { provider, calls } = makeProvider([
      { status: 200, body: { id: 99, name: 'main', enforcement: 'active' } },
    ])
    await provider.updateRuleset(REPO, 99, { name: 'main' })
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url).toBe(`https://api.github.com/repos/${REPO}/rulesets/99`)
  })

  it('upsertEnvironment → PUT to environments/{name} with reviewer numeric ids', async () => {
    const { provider, calls } = makeProvider([{ status: 200, body: { name: 'production' } }])
    await provider.upsertEnvironment(REPO, {
      name: 'production',
      // GitHub's reviewer API requires the numeric `id`, NOT login.
      required_reviewers: [{ type: 'User', id: 5769156 }],
      wait_timer: 0,
    })
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url).toBe(`https://api.github.com/repos/${REPO}/environments/production`)
    const body = calls[0]?.body as { reviewers: Array<{ type: string; id: number }> }
    expect(body.reviewers[0]).toEqual({ type: 'User', id: 5769156 })
  })

  it('updateRepoSettings → PATCH /repos/{repo} with settings', async () => {
    const { provider, calls } = makeProvider([{ status: 200, body: {} }])
    await provider.updateRepoSettings(REPO, { allow_squash_merge: true })
    expect(calls[0]?.method).toBe('PATCH')
    expect(calls[0]?.url).toBe(`https://api.github.com/repos/${REPO}`)
    expect(calls[0]?.body).toEqual({ allow_squash_merge: true })
  })

  it('getRepoSecretPublicKey returns {key_id, key}', async () => {
    const body = { key_id: '123', key: 'YmFzZTY0a2V5' }
    const { provider, calls } = makeProvider([{ status: 200, body }])
    const result = await provider.getRepoSecretPublicKey(REPO)
    expect(result).toEqual(body)
    expect(calls[0]?.url).toBe(`https://api.github.com/repos/${REPO}/actions/secrets/public-key`)
  })

  it('getEnvironmentSecretPublicKey → environment-scoped endpoint', async () => {
    const body = { key_id: '456', key: 'YmFzZTY0a2V5' }
    const { provider, calls } = makeProvider([{ status: 200, body }])
    const result = await provider.getEnvironmentSecretPublicKey(REPO, 'production')
    expect(result).toEqual(body)
    expect(calls[0]?.url).toBe(
      `https://api.github.com/repos/${REPO}/environments/production/secrets/public-key`,
    )
  })

  it('setRepoSecret → PUT with encrypted_value + key_id', async () => {
    const { provider, calls } = makeProvider([{ status: 200, body: {} }])
    await provider.setRepoSecret(REPO, 'MY_SECRET', 'ZW5jcnlwdGVk', 'keyid')
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url).toBe(`https://api.github.com/repos/${REPO}/actions/secrets/MY_SECRET`)
    expect(calls[0]?.body).toEqual({ encrypted_value: 'ZW5jcnlwdGVk', key_id: 'keyid' })
  })

  it('setEnvironmentSecret → environment-scoped PUT', async () => {
    const { provider, calls } = makeProvider([{ status: 200, body: {} }])
    await provider.setEnvironmentSecret(REPO, 'staging', 'X', 'enc', 'key')
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url).toBe(
      `https://api.github.com/repos/${REPO}/environments/staging/secrets/X`,
    )
  })

  it('enableVulnerabilityAlerts → PUT /repos/{repo}/vulnerability-alerts', async () => {
    const { provider, calls } = makeProvider([{ status: 200, body: {} }])
    await provider.enableVulnerabilityAlerts(REPO)
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url).toBe(`https://api.github.com/repos/${REPO}/vulnerability-alerts`)
  })

  it('enableAutomatedSecurityFixes → PUT /repos/{repo}/automated-security-fixes', async () => {
    const { provider, calls } = makeProvider([{ status: 200, body: {} }])
    await provider.enableAutomatedSecurityFixes(REPO)
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url).toBe(`https://api.github.com/repos/${REPO}/automated-security-fixes`)
  })

  it('enableSecretScanning → PATCH /repos/{repo} with security_and_analysis flags', async () => {
    const { provider, calls } = makeProvider([{ status: 200, body: {} }])
    await provider.enableSecretScanning(REPO)
    expect(calls[0]?.method).toBe('PATCH')
    expect(calls[0]?.url).toBe(`https://api.github.com/repos/${REPO}`)
    expect(calls[0]?.body).toEqual({
      security_and_analysis: {
        secret_scanning: { status: 'enabled' },
        secret_scanning_push_protection: { status: 'enabled' },
      },
    })
  })

  it('enablePrivateVulnerabilityReporting → PUT /repos/{repo}/private-vulnerability-reporting', async () => {
    const { provider, calls } = makeProvider([{ status: 200, body: {} }])
    await provider.enablePrivateVulnerabilityReporting(REPO)
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url).toBe(
      `https://api.github.com/repos/${REPO}/private-vulnerability-reporting`,
    )
  })

  it('enableOrgTwoFactorRequirement → PATCH /orgs/{org} with the 2fa flag', async () => {
    const { provider, calls } = makeProvider([{ status: 200, body: {} }])
    await provider.enableOrgTwoFactorRequirement('rando-id')
    expect(calls[0]?.method).toBe('PATCH')
    expect(calls[0]?.url).toBe('https://api.github.com/orgs/rando-id')
    expect(calls[0]?.body).toEqual({ two_factor_requirement_enabled: true })
  })
})
