import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run } from '../cli'
import type { Adapters } from '../config'
import type { DbProvider } from '../domain/db'
import { captureIo } from './helpers'

const tmpDirs: string[] = []
afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function writeConfig(): { path: string; cwd: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rando-db-sync-'))
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

function adaptersWithDb(db: DbProvider): Adapters {
  const never = () => {
    throw new Error('not expected to be called')
  }
  return {
    db: () => db,
    tunnel: never as never,
    dns: never as never,
    deploy: never as never,
    tracker: never as never,
    apiTesting: never as never,
    postman: never as never,
    secrets: never as never,
    gh: never as never,
    ghAdmin: never as never,
    vercelCli: never as never,
  }
}

const projects = [{ id: 'p1', name: 'rando' }]
const branches = [
  { id: 'br_main', name: 'main', parentId: null, createdAt: 'x' },
  { id: 'br_staging', name: 'staging', parentId: 'br_main', createdAt: 'x' },
]

describe('db sync', () => {
  it('resolves names → ids and calls resetBranch with --yes', async () => {
    const db: Partial<DbProvider> = {
      listProjects: vi.fn(async () => projects),
      listBranches: vi.fn(async () => branches),
      resetBranch: vi.fn(async () => {}),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['db', 'sync', '--from', 'main', '--to', 'staging', '--config', path, '--yes'], {
        adapters: adaptersWithDb(db as DbProvider),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      cwdSpy.mockRestore()
    }
    expect(db.resetBranch).toHaveBeenCalledWith({
      projectId: 'p1',
      branchId: 'br_staging',
      sourceBranchId: 'br_main',
    })
    expect(io.confirmCalls).toHaveLength(0) // --yes suppressed the prompt
    expect(io.stdout.join('\n')).toContain('sync complete')
  })

  it('warns loudly when destination is main', async () => {
    const db: Partial<DbProvider> = {
      listProjects: vi.fn(async () => projects),
      listBranches: vi.fn(async () => branches),
      resetBranch: vi.fn(async () => {}),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['db', 'sync', '--from', 'staging', '--to', 'main', '--config', path, '--yes'], {
        adapters: adaptersWithDb(db as DbProvider),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      cwdSpy.mockRestore()
    }
    expect(io.stderr.join('\n')).toMatch(/WARNING.*overwrites production/)
    expect(db.resetBranch).toHaveBeenCalled()
  })

  it('aborts on user decline (no --yes)', async () => {
    const db: Partial<DbProvider> = {
      listProjects: vi.fn(async () => projects),
      listBranches: vi.fn(async () => branches),
      resetBranch: vi.fn(async () => {}),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo({ confirm: false })
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['db', 'sync', '--from', 'main', '--to', 'staging', '--config', path], {
        adapters: adaptersWithDb(db as DbProvider),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    } finally {
      cwdSpy.mockRestore()
    }
    expect(db.resetBranch).not.toHaveBeenCalled()
    expect(io.stdout.join('\n')).toContain('aborted.')
  })

  it('rejects --from === --to', async () => {
    const db: Partial<DbProvider> = {
      listProjects: vi.fn(),
      listBranches: vi.fn(),
      resetBranch: vi.fn(),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const exit = vi.fn() as unknown as (code: number) => never
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['db', 'sync', '--from', 'main', '--to', 'main', '--config', path, '--yes'], {
        adapters: adaptersWithDb(db as DbProvider),
        io: io.io,
        exit,
      })
    } finally {
      cwdSpy.mockRestore()
    }
    expect(exit).toHaveBeenCalledWith(1)
    expect(io.stderr.join('\n')).toMatch(/must be different/)
  })

  it('NotFoundError when source branch does not exist', async () => {
    const db: Partial<DbProvider> = {
      listProjects: vi.fn(async () => projects),
      listBranches: vi.fn(async () => branches),
      resetBranch: vi.fn(),
    }
    const { path, cwd } = writeConfig()
    const io = captureIo()
    const exit = vi.fn() as unknown as (code: number) => never
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    try {
      await run(['db', 'sync', '--from', 'ghost', '--to', 'staging', '--config', path, '--yes'], {
        adapters: adaptersWithDb(db as DbProvider),
        io: io.io,
        exit,
      })
    } finally {
      cwdSpy.mockRestore()
    }
    expect(exit).toHaveBeenCalledWith(3)
    expect(io.stderr.join('\n')).toMatch(/source branch not found: ghost/)
  })
})
