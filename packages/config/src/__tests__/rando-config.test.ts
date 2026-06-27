import { describe, expect, it } from 'vitest'
import { SetupConfigSchema, ALL_SECRETS_ENVS } from '../rando-config'

const minimal = {
  project: 'rando',
  repo: 'me/rando',
  domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
  apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
}

describe('SetupConfigSchema', () => {
  it('parses a minimal config and applies vendor defaults', () => {
    const parsed = SetupConfigSchema.parse(minimal)
    expect(parsed.tunnel).toEqual({ kind: 'cloudflare', name: 'rando-dev' })
    expect(parsed.dns).toEqual({ kind: 'cloudflare' })
    expect(parsed.deploy).toEqual({ kind: 'vercel' })
    expect(parsed.vc).toEqual({ kind: 'github' })
    expect(parsed.apps[0]?.prodApex).toBe(false)
  })

  it('honours explicit overrides for the vendor blocks', () => {
    const parsed = SetupConfigSchema.parse({
      ...minimal,
      tunnel: { kind: 'cloudflare', name: 'holonet-dev' },
      vc: { kind: 'github' },
    })
    expect(parsed.tunnel.name).toBe('holonet-dev')
  })

  it('rejects an invalid repo format', () => {
    const result = SetupConfigSchema.safeParse({ ...minimal, repo: 'notarepo' })
    expect(result.success).toBe(false)
  })

  it('rejects unknown vendor kinds at the discriminator', () => {
    const result = SetupConfigSchema.safeParse({
      ...minimal,
      vc: { kind: 'gitlab' },
    })
    expect(result.success).toBe(false)
  })

  it('parses the tracker block with github defaults', () => {
    const parsed = SetupConfigSchema.parse({
      ...minimal,
      tracker: { kind: 'github', protectedBranches: ['main'] },
    })
    expect(parsed.tracker?.kind).toBe('github')
    expect(parsed.tracker?.github?.labels.inProgress).toBe('status:in-progress')
  })

  it('parses the secrets block with environments', () => {
    const parsed = SetupConfigSchema.parse({
      ...minimal,
      secrets: {
        kind: '1password',
        account: 'ACC123',
        environments: { local: 'local-env-id' },
      },
    })
    expect(parsed.secrets?.environments.local).toBe('local-env-id')
    expect(parsed.secrets?.field).toBe('credential')
  })

  it('parses the db + testing.api blocks with kind defaults', () => {
    const parsed = SetupConfigSchema.parse({
      ...minimal,
      db: { kind: 'neon', managedBy: 'vercel' },
      testing: { api: { kind: 'postman', workspaceId: 'ws-123' } },
    })
    expect(parsed.db?.plan).toBe('free_v3')
    expect(parsed.testing?.api?.workspaceId).toBe('ws-123')
  })

  it('exports ALL_SECRETS_ENVS as a complete tuple', () => {
    expect(ALL_SECRETS_ENVS).toEqual(['local', 'staging', 'prod'])
  })
})
