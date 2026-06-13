import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hostnameFor, loadSetupConfig, SetupConfigError, vercelProjectName } from '../setup-config'

const tmp: string[] = []
afterEach(() => {
  while (tmp.length) {
    const path = tmp.pop()
    if (path) rmSync(path, { recursive: true, force: true })
  }
})

function writeTempConfig(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'rando-cli-'))
  tmp.push(dir)
  const path = join(dir, 'rando.config.json')
  writeFileSync(path, JSON.stringify(value))
  return path
}

const validConfig = {
  project: 'rando',
  repo: 'me/rando',
  domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
  apps: [
    { name: 'api', rootDirectory: 'apps/api', port: 4000 },
    { name: 'web', rootDirectory: 'apps/web', port: 3000, prodApex: true },
  ],
}

describe('loadSetupConfig', () => {
  it('parses a valid config and applies defaults', () => {
    const path = writeTempConfig(validConfig)
    const config = loadSetupConfig(path)
    expect(config.project).toBe('rando')
    expect(config.tunnel).toBe('rando-dev') // default
    expect(config.apps[1]?.prodApex).toBe(true)
    expect(config.apps[0]?.prodApex).toBe(false) // default
  })

  it('throws SetupConfigError for missing file', () => {
    expect(() => loadSetupConfig('/no/such/file.json')).toThrowError(SetupConfigError)
  })

  it('throws SetupConfigError for invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rando-cli-'))
    tmp.push(dir)
    const path = join(dir, 'rando.config.json')
    writeFileSync(path, '{not json')
    expect(() => loadSetupConfig(path)).toThrowError(/not valid JSON/)
  })

  it('rejects bad repo shape', () => {
    const path = writeTempConfig({ ...validConfig, repo: 'no-slash' })
    expect(() => loadSetupConfig(path)).toThrowError(/repo/)
  })

  it('rejects empty apps array', () => {
    const path = writeTempConfig({ ...validConfig, apps: [] })
    expect(() => loadSetupConfig(path)).toThrowError(SetupConfigError)
  })
})

describe('hostnameFor', () => {
  const path = writeTempConfig(validConfig)
  const config = loadSetupConfig(path)
  const api = config.apps[0]!
  const web = config.apps[1]!

  it('dev gets dev- prefix on nonProd zone', () => {
    expect(hostnameFor(config, 'dev', api)).toBe('dev-api.rando-id.dev')
  })

  it('staging gets staging- prefix on nonProd zone', () => {
    expect(hostnameFor(config, 'staging', api)).toBe('staging-api.rando-id.dev')
  })

  it('production puts non-apex apps on subdomain', () => {
    expect(hostnameFor(config, 'production', api)).toBe('api.rando.id')
  })

  it('production puts apex apps at the apex', () => {
    expect(hostnameFor(config, 'production', web)).toBe('rando.id')
  })
})

describe('vercelProjectName', () => {
  it('joins project + app with a dash', () => {
    const path = writeTempConfig(validConfig)
    const config = loadSetupConfig(path)
    expect(vercelProjectName(config, config.apps[0]!)).toBe('rando-api')
  })
})
