import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run } from '../cli'
import type { Adapters } from '../config'
import type { GhAdminProvider } from '../domain/gh-admin'
import { captureIo } from './helpers'

const tmpDirs: string[] = []
afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  delete process.env.RANDO_ADMIN_TOKEN
})

function writeConfig(): { path: string; cwd: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rando-cli-vc-'))
  tmpDirs.push(dir)
  const path = join(dir, 'rando.config.json')
  writeFileSync(
    path,
    JSON.stringify({
      project: 'rando',
      repo: 'iamnewton/rando',
      domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
      apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
    }),
  )
  return { path, cwd: dir }
}

function never(kind: string): never {
  throw new Error(`${kind} adapter should not be touched in this test`)
}

function fakeAdapters(ghAdmin: () => GhAdminProvider = () => never('ghAdmin')): Adapters {
  return {
    db: () => never('db'),
    tunnel: () => never('tunnel'),
    deploy: () => never('deploy'),
    dns: () => never('dns'),
    tracker: () => never('tracker'),
    apiTesting: () => never('apiTesting'),
    postman: () => never('postman'),
    secrets: () => never('secrets'),
    gh: () => never('gh'),
    ghAdmin,
    vercelCli: () => never('vercelCli'),
  }
}

describe('version-control (vc) command', () => {
  it('vc setup --dry-run prints plan without calling APIs', async () => {
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['vc', 'setup', '--admin-token', 'fake', '--config', path, '--dry-run'], {
        adapters: fakeAdapters(),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      spy.mockRestore()
    }
    const text = io.stdout.join('\n')
    expect(text).toContain('dry-run')
    expect(text).toContain('ruleset')
    expect(text).toContain('CODEOWNERS')
  })

  it('codeowners --dry-run renders content without writing', async () => {
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['vc', 'codeowners', '--config', path, '--dry-run'], {
        adapters: fakeAdapters(),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      spy.mockRestore()
    }
    const text = io.stdout.join('\n')
    expect(text).toContain('@iamnewton')
    expect(existsSync(join(cwd, '.github/CODEOWNERS'))).toBe(false)
  })

  it('codeowners writes .github/CODEOWNERS', async () => {
    const { path, cwd } = writeConfig()
    mkdirSync(join(cwd, '.github'), { recursive: true })
    const io = captureIo()
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['vc', 'codeowners', '--config', path], {
        adapters: fakeAdapters(),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      spy.mockRestore()
    }
    const written = readFileSync(join(cwd, '.github/CODEOWNERS'), 'utf-8')
    expect(written).toContain('* @iamnewton')
  })

  it('ruleset --dry-run mentions the source file', async () => {
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['vc', 'ruleset', '--admin-token', 'fake', '--config', path, '--dry-run'], {
        adapters: fakeAdapters(),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      spy.mockRestore()
    }
    const text = io.stdout.join('\n')
    expect(text).toContain('.github/rulesets/main.json')
    expect(text).toContain('iamnewton/rando')
  })

  it('repo-settings --dry-run prints the settings JSON', async () => {
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['vc', 'repo-settings', '--admin-token', 'fake', '--config', path, '--dry-run'], {
        adapters: fakeAdapters(),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      spy.mockRestore()
    }
    const text = io.stdout.join('\n')
    expect(text).toContain('allow_squash_merge')
    expect(text).toContain('delete_branch_on_merge')
  })

  it('setup without --admin-token (and without env var) errors', async () => {
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    const exit = vi.fn() as unknown as (code: number) => never
    try {
      await run(['vc', 'setup', '--config', path, '--dry-run'], {
        adapters: fakeAdapters(),
        io: io.io,
        exit,
      })
    } finally {
      spy.mockRestore()
    }
    const text = io.stderr.join('\n')
    expect(text).toContain('No admin PAT')
    expect(exit).toHaveBeenCalled()
  })

  it('setup picks up RANDO_ADMIN_TOKEN env var when --admin-token absent', async () => {
    process.env.RANDO_ADMIN_TOKEN = 'env-token'
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['vc', 'setup', '--config', path, '--dry-run'], {
        adapters: fakeAdapters(),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      spy.mockRestore()
    }
    // Dry-run completes without error means the token was resolved.
    expect(io.stderr.join('\n')).not.toContain('No admin PAT')
  })

  it('revoke-token uses the injected ghAdmin adapter', async () => {
    const revokeAdminToken = vi.fn(async () => undefined)
    const mock: GhAdminProvider = {
      whoami: vi.fn(),
      listRulesets: vi.fn(),
      createRuleset: vi.fn(),
      updateRuleset: vi.fn(),
      upsertEnvironment: vi.fn(),
      updateRepoSettings: vi.fn(),
      getRepoSecretPublicKey: vi.fn(),
      getEnvironmentSecretPublicKey: vi.fn(),
      setRepoSecret: vi.fn(),
      setEnvironmentSecret: vi.fn(),
      revokeAdminToken,
    } as unknown as GhAdminProvider
    const { cwd } = writeConfig()
    const io = captureIo()
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['vc', 'revoke-token', '--admin-token', 'fake', '--token-id', '999'], {
        adapters: fakeAdapters(() => mock),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      spy.mockRestore()
    }
    expect(revokeAdminToken).toHaveBeenCalledWith(999)
  })
})
