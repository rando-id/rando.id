import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run } from '../cli'
import type { Adapters } from '../config'
import { captureIo } from './helpers'

const tmpDirs: string[] = []
afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function writeConfig(): { path: string; cwd: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rando-cli-'))
  tmpDirs.push(dir)
  const path = join(dir, 'rando.config.json')
  writeFileSync(
    path,
    JSON.stringify({
      project: 'rando',
      repo: 'me/rando',
      domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
      apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
    }),
  )
  return { path, cwd: dir }
}

function fakeAdapters(): Adapters {
  // The dry-run path never invokes any provider methods.
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
    vercelCli: () => never('vercelCli'),
  }
}

function never(kind: string): never {
  throw new Error(`${kind} adapter should not be touched in this test`)
}

describe('infrastructure setup command', () => {
  it('--dry-run prints plan without calling any adapter', async () => {
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['infrastructure', 'setup', '--config', path, '--dry-run'], {
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
    expect(text).toContain('config:')
    expect(text).toContain('project: rando')
    expect(text).toContain('envs:    dev, staging, production')
    expect(text).toContain('apps:    api')
    expect(text).toContain('--dry-run')
  })

  it('rejects unknown env values', async () => {
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const exit = vi.fn() as unknown as (code: number) => never
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['infrastructure', 'setup', '--config', path, '--env', 'staging,nope'], {
        adapters: fakeAdapters(),
        io: io.io,
        exit,
      })
    } finally {
      spy.mockRestore()
    }
    expect(exit).toHaveBeenCalledWith(1)
    expect(io.stderr.join('\n')).toMatch(/Invalid env/)
  })

  it('surfaces SetupConfigError with exit code 2 when config is missing', async () => {
    const io = captureIo()
    const exit = vi.fn() as unknown as (code: number) => never
    await run(['infrastructure', 'setup', '--config', '/no/such/file.json', '--dry-run'], {
      adapters: fakeAdapters(),
      io: io.io,
      exit,
    })
    expect(exit).toHaveBeenCalledWith(2)
    expect(io.stderr.join('\n')).toMatch(/Could not read config/)
  })
})

describe('infrastructure destroy command', () => {
  it('--env production is refused before any adapter is touched', async () => {
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const exit = vi.fn() as unknown as (code: number) => never
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['infrastructure', 'destroy', '--config', path, '--env', 'production', '--yes'], {
        adapters: fakeAdapters(),
        io: io.io,
        exit,
      })
    } finally {
      spy.mockRestore()
    }
    expect(exit).toHaveBeenCalledWith(1)
    expect(io.stderr.join('\n')).toMatch(/Refusing to destroy production/)
  })

  it('aborts when the user does not confirm', async () => {
    const { path, cwd } = writeConfig()
    const io = captureIo({ confirm: false })
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['infrastructure', 'destroy', '--config', path, '--env', 'dev'], {
        adapters: fakeAdapters(),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      spy.mockRestore()
    }
    expect(io.confirmCalls).toHaveLength(1)
    expect(io.stdout.join('\n')).toContain('aborted.')
  })

  it('--yes skips the confirm prompt', async () => {
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(
        ['infrastructure', 'destroy', '--config', path, '--env', 'dev', '--yes', '--dry-run'],
        {
          adapters: fakeAdapters(),
          io: io.io,
          exit: () => {
            throw new Error('unexpected exit')
          },
        },
      )
    } finally {
      spy.mockRestore()
    }
    expect(io.confirmCalls).toHaveLength(0)
    expect(io.stdout.join('\n')).toContain('--dry-run')
  })
})
