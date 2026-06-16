// Tests for the per-arg interactive prompting layer. Verifies that
// commands prompt for missing positionals via `io.select`/`io.input` when
// running interactively, and fail loudly with a clear hint otherwise.

import { describe, expect, it, vi } from 'vitest'
import { run } from '../cli'
import type { Adapters } from '../config'
import type { DbProvider } from '../domain/db'
import { captureIo } from './helpers'

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
    postman: never as never,
    secrets: never as never,
    gh: never as never,
  }
}

async function withTty<T>(value: boolean, fn: () => Promise<T>): Promise<T> {
  // vitest's process.stdout doesn't have isTTY as an own property by
  // default, so we define it ourselves and remove it after. This avoids
  // `vi.spyOn` failing with "isTTY does not exist".
  const had = Object.prototype.hasOwnProperty.call(process.stdout, 'isTTY')
  const prev = (process.stdout as { isTTY?: boolean }).isTTY
  Object.defineProperty(process.stdout, 'isTTY', {
    value,
    configurable: true,
    writable: true,
  })
  try {
    return await fn()
  } finally {
    if (had) {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: prev,
        configurable: true,
        writable: true,
      })
    } else {
      delete (process.stdout as { isTTY?: boolean }).isTTY
    }
  }
}

describe('interactive prompting — missing positionals', () => {
  it('db project delete prompts for projectId from a select-from-list', async () => {
    const db: Partial<DbProvider> = {
      listProjects: vi.fn(async () => [
        { id: 'p1', name: 'rando' },
        { id: 'p2', name: 'other' },
      ]),
      deleteProject: vi.fn(async () => {}),
    }
    const io = captureIo({ selectResponses: ['p2'] })
    await withTty(true, async () => {
      await run(['db', 'project', 'delete', '--yes'], {
        adapters: adaptersWithDb(db as DbProvider),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    })
    expect(io.selectCalls).toHaveLength(1)
    expect(io.selectCalls[0]?.choices.map((c) => c.value)).toEqual(['p1', 'p2'])
    expect(db.deleteProject).toHaveBeenCalledWith({ projectId: 'p2' })
  })

  it('db branch delete prompts for project then branch sequentially', async () => {
    const db: Partial<DbProvider> = {
      listProjects: vi.fn(async () => [{ id: 'p1', name: 'rando' }]),
      listBranches: vi.fn(async () => [
        { id: 'br_main', name: 'main', parentId: null, createdAt: 'x' },
        { id: 'br_staging', name: 'staging', parentId: 'br_main', createdAt: 'x' },
      ]),
      deleteBranch: vi.fn(async () => {}),
    }
    const io = captureIo({ selectResponses: ['p1', 'br_staging'] })
    await withTty(true, async () => {
      await run(['db', 'branch', 'delete', '--yes'], {
        adapters: adaptersWithDb(db as DbProvider),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    })
    expect(io.selectCalls).toHaveLength(2)
    expect(db.deleteBranch).toHaveBeenCalledWith({ projectId: 'p1', branchId: 'br_staging' })
  })

  it('db project create prompts for the new name via input', async () => {
    const db: Partial<DbProvider> = {
      createProject: vi.fn(async ({ name }) => ({ id: 'p1', name })),
    }
    const io = captureIo({ inputResponses: ['fresh-project'] })
    await withTty(true, async () => {
      await run(['db', 'project', 'create', '--yes'], {
        adapters: adaptersWithDb(db as DbProvider),
        io: io.io,
        exit: () => {
          throw new Error('unexpected exit')
        },
      })
    })
    expect(io.inputCalls).toHaveLength(1)
    expect(db.createProject).toHaveBeenCalledWith({ name: 'fresh-project', region: undefined })
  })

  it('non-TTY context with missing positional throws a clear error', async () => {
    const db: Partial<DbProvider> = {
      listProjects: vi.fn(),
      deleteProject: vi.fn(),
    }
    const io = captureIo()
    const exit = vi.fn() as unknown as (code: number) => never
    await withTty(false, async () => {
      await run(['db', 'project', 'delete', '--yes'], {
        adapters: adaptersWithDb(db as DbProvider),
        io: io.io,
        exit,
      })
    })
    expect(exit).toHaveBeenCalledWith(1)
    expect(io.stderr.join('\n')).toMatch(/Missing required argument <projectId>/)
    expect(db.deleteProject).not.toHaveBeenCalled()
  })
})
