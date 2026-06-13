import { describe, expect, it } from 'vitest'
import { createAdapters } from '../config'
import { MissingConfigError } from '../domain/errors'
import { NeonDbProvider } from '../adapters/neon'
import { CloudflareTunnelProvider } from '../adapters/cloudflare-tunnel'
import { CloudflareDnsProvider } from '../adapters/cloudflare-dns'
import { VercelDeployProvider } from '../adapters/vercel'

describe('createAdapters', () => {
  it('db getter returns a NeonDbProvider when NEON_API_KEY is set', () => {
    const adapters = createAdapters({ NEON_API_KEY: 'x' } as NodeJS.ProcessEnv)
    expect(adapters.db()).toBeInstanceOf(NeonDbProvider)
  })

  it('db getter throws MissingConfigError when NEON_API_KEY is unset', () => {
    const adapters = createAdapters({} as NodeJS.ProcessEnv)
    expect(() => adapters.db()).toThrowError(MissingConfigError)
  })

  it('tunnel + dns getters share Cloudflare env, each validates separately', () => {
    const adapters = createAdapters({
      CLOUDFLARE_API_TOKEN: 't',
      CLOUDFLARE_ACCOUNT_ID: 'a',
    } as NodeJS.ProcessEnv)
    expect(adapters.tunnel()).toBeInstanceOf(CloudflareTunnelProvider)
    expect(adapters.dns()).toBeInstanceOf(CloudflareDnsProvider)
  })

  it('deploy getter accepts VERCEL_TEAM_ID as optional', () => {
    const adapters = createAdapters({ VERCEL_TOKEN: 'tok' } as NodeJS.ProcessEnv)
    expect(adapters.deploy()).toBeInstanceOf(VercelDeployProvider)
  })

  it('one missing var does not break the other adapters', () => {
    const adapters = createAdapters({
      NEON_API_KEY: 'k',
    } as NodeJS.ProcessEnv)
    // db is fine
    expect(adapters.db()).toBeDefined()
    // tunnel needs Cloudflare creds; should throw
    expect(() => adapters.tunnel()).toThrowError(MissingConfigError)
  })
})
