import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'
import type { Adapters } from '../config'
import type { JiraIssue, JiraProvider } from '../domain/jira'
import { MissingConfigError } from '../domain/errors'
import type { GitRunner } from '../git'
import { jiraCommand } from '../commands/jira'
import { captureIo } from './helpers'

function mockAdapters(jira: JiraProvider | (() => never)): Adapters {
  const never = (() => {
    throw new Error('not expected to be called')
  }) as never
  return {
    db: never,
    tunnel: never,
    dns: never,
    deploy: never,
    jira: typeof jira === 'function' ? jira : () => jira,
  }
}

function fakeGit(state: Record<string, string | null> = {}): {
  git: GitRunner
  calls: string[][]
} {
  const calls: string[][] = []
  const config = { ...state }
  return {
    git: {
      run(args) {
        calls.push(args)
        if (args[0] === 'rev-parse') return config['__branch'] ?? 'feat-x'
        if (args[0] === 'config' && args[1] === '--replace-all') {
          const key = args[2] ?? ''
          config[key] = args[3] ?? ''
          return ''
        }
        if (args[0] === 'config' && args[1] === '--unset') {
          const key = args[2] ?? ''
          delete config[key]
          return ''
        }
        if (args[0] === 'config') {
          const key = args[1] ?? ''
          return config[key] ?? null
        }
        return null
      },
    },
    calls,
  }
}

const ISSUE_A: JiraIssue = {
  key: 'RANDO-1',
  id: 'i_1',
  summary: 'First',
  status: { id: '2', name: 'In Progress', category: 'indeterminate' },
  assignee: null,
  updated: '2026-06-13T00:00:00Z',
}
const ISSUE_B: JiraIssue = { ...ISSUE_A, key: 'RANDO-2', id: 'i_2', summary: 'Second' }

function jiraProvider(overrides: Partial<JiraProvider> = {}): JiraProvider {
  return {
    getMyself: vi.fn(),
    getProject: vi.fn(),
    listStatuses: vi.fn(),
    listTransitions: vi.fn(),
    searchIssues: vi.fn(async () => [ISSUE_A, ISSUE_B]),
    getIssue: vi.fn(),
    createIssue: vi.fn(async () => ({ key: 'RANDO-99' })),
    transitionIssue: vi.fn(),
    addComment: vi.fn(),
    ...overrides,
  }
}

function writeConfigWithJira(projectKey = 'RANDO') {
  const dir = mkdtempSync(join(tmpdir(), 'jira-pick-'))
  const path = join(dir, 'rando.config.json')
  writeFileSync(
    path,
    JSON.stringify({
      project: 'rando',
      repo: 'rando-id/rando',
      domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
      apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
      jira: { projectKey, transitions: {} },
    }),
  )
  return path
}

let cwdSpy: ReturnType<typeof vi.spyOn> | undefined

beforeEach(() => {
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/tmp')
})

afterEach(() => {
  cwdSpy?.mockRestore()
})

/** Same pattern as interactive.test.ts — askOr needs isTTY=true to call io.input. */
async function withTty<T>(value: boolean, fn: () => Promise<T>): Promise<T> {
  const had = Object.prototype.hasOwnProperty.call(process.stdout, 'isTTY')
  const prev = (process.stdout as { isTTY?: boolean }).isTTY
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true, writable: true })
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

/** Run `rando jira pick ...` against an injected git runner. */
async function runPick(
  args: string[],
  adapters: Adapters,
  io: ReturnType<typeof captureIo>,
  git: GitRunner,
) {
  const program = new Command().exitOverride()
  program.addCommand(jiraCommand(adapters, io.io, { git }))
  await program.parseAsync(['node', 'rando', 'jira', ...args])
}

describe('jira pick', () => {
  it('caches the picked ticket key in git config', async () => {
    const path = writeConfigWithJira()
    const io = captureIo({ selectResponses: ['RANDO-1'] })
    const g = fakeGit({ __branch: 'feat-search' })
    await runPick(['pick', '--config', path], mockAdapters(jiraProvider()), io, g.git)
    expect(g.git.run(['config', 'branch.feat-search.jira-key'])).toBe('RANDO-1')
    expect(io.stdout.join('\n')).toContain('RANDO-1 cached for branch feat-search')
  })

  it('stores the "skip" sentinel when the user picks the Skip option', async () => {
    const path = writeConfigWithJira()
    const io = captureIo({ selectResponses: ['__skip__'] })
    const g = fakeGit({ __branch: 'feat-skip' })
    await runPick(['pick', '--config', path], mockAdapters(jiraProvider()), io, g.git)
    expect(g.git.run(['config', 'branch.feat-skip.jira-key'])).toBe('skip')
    expect(io.stdout.join('\n')).toContain('skipped')
  })

  it('creates a new ticket when "+ Create a new ticket" is picked', async () => {
    const path = writeConfigWithJira()
    const jira = jiraProvider()
    const io = captureIo({
      selectResponses: ['__create_new__'],
      inputResponses: ['Brand new ticket'],
    })
    const g = fakeGit({ __branch: 'feat-new' })
    await withTty(true, () => runPick(['pick', '--config', path], mockAdapters(jira), io, g.git))
    expect(jira.createIssue).toHaveBeenCalledWith({
      projectKey: 'RANDO',
      summary: 'Brand new ticket',
    })
    expect(g.git.run(['config', 'branch.feat-new.jira-key'])).toBe('RANDO-99')
    expect(io.stdout.join('\n')).toContain('created RANDO-99')
  })

  it('shows a hint and exits early when the branch already has a cached key', async () => {
    const path = writeConfigWithJira()
    const jira = jiraProvider()
    const io = captureIo()
    const g = fakeGit({ __branch: 'feat-cached', 'branch.feat-cached.jira-key': 'RANDO-5' })
    await runPick(['pick', '--config', path], mockAdapters(jira), io, g.git)
    expect(jira.searchIssues).not.toHaveBeenCalled()
    expect(io.stdout.join('\n')).toContain('already cached: RANDO-5')
  })

  it('--from-hook silently exits when the branch is already cached (no log spam)', async () => {
    const path = writeConfigWithJira()
    const jira = jiraProvider()
    const io = captureIo()
    const g = fakeGit({ __branch: 'feat-cached', 'branch.feat-cached.jira-key': 'RANDO-5' })
    await runPick(['pick', '--from-hook', '--config', path], mockAdapters(jira), io, g.git)
    expect(jira.searchIssues).not.toHaveBeenCalled()
    expect(io.stdout).toEqual([])
  })

  it('--reset clears the cached key and exits', async () => {
    const path = writeConfigWithJira()
    const io = captureIo()
    const g = fakeGit({ __branch: 'feat-reset', 'branch.feat-reset.jira-key': 'RANDO-1' })
    await runPick(['pick', '--reset', '--config', path], mockAdapters(jiraProvider()), io, g.git)
    expect(g.git.run(['config', 'branch.feat-reset.jira-key'])).toBeNull()
    expect(io.stdout.join('\n')).toContain('cleared cached ticket for feat-reset')
  })

  it('exits cleanly when not on a branch (detached HEAD)', async () => {
    const io = captureIo()
    const g = fakeGit({ __branch: 'HEAD' })
    await runPick(['pick'], mockAdapters(jiraProvider()), io, g.git)
    expect(io.stderr.join('\n')).toContain('no current branch')
  })

  it('--from-hook softens MissingConfigError into a no-op', async () => {
    const path = writeConfigWithJira()
    const io = captureIo()
    const g = fakeGit({ __branch: 'feat-x' })
    const adapters = mockAdapters(() => {
      throw new MissingConfigError('JIRA_API_TOKEN', 'jira')
    })
    await runPick(['pick', '--from-hook', '--config', path], adapters, io, g.git)
    expect(io.stderr.join('\n')).toContain('JIRA_API_TOKEN unset')
    // Nothing was cached.
    expect(g.git.run(['config', 'branch.feat-x.jira-key'])).toBeNull()
  })

  it('--from-hook softens "no projectKey" into a no-op (config has no jira block)', async () => {
    // Config without a jira block; --from-hook should NOT throw.
    const dir = mkdtempSync(join(tmpdir(), 'jira-pick-noproj-'))
    const path = join(dir, 'rando.config.json')
    writeFileSync(
      path,
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando',
        domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
      }),
    )
    const io = captureIo()
    const g = fakeGit({ __branch: 'feat-x' })
    await runPick(
      ['pick', '--from-hook', '--config', path],
      mockAdapters(jiraProvider()),
      io,
      g.git,
    )
    expect(io.stderr.join('\n')).toContain('no jira.projectKey')
  })

  it('--check exits silently when Jira is fully configured', async () => {
    const path = writeConfigWithJira()
    const io = captureIo()
    const g = fakeGit({ __branch: 'feat-x' })
    await runPick(['pick', '--check', '--config', path], mockAdapters(jiraProvider()), io, g.git)
    expect(io.stdout).toEqual([])
    expect(io.stderr).toEqual([])
  })

  it('--check throws when JIRA_* env is missing (adapter throws on access)', async () => {
    const path = writeConfigWithJira()
    const io = captureIo()
    const g = fakeGit({ __branch: 'feat-x' })
    const adapters = mockAdapters(() => {
      throw new MissingConfigError('JIRA_API_TOKEN', 'jira')
    })
    await expect(
      runPick(['pick', '--check', '--config', path], adapters, io, g.git),
    ).rejects.toThrow(/missing JIRA_\* env vars/)
  })

  it('--check throws when there is no projectKey in config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jira-pick-check-'))
    const path = join(dir, 'rando.config.json')
    writeFileSync(
      path,
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando',
        domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
      }),
    )
    const io = captureIo()
    const g = fakeGit({ __branch: 'feat-x' })
    await expect(
      runPick(['pick', '--check', '--config', path], mockAdapters(jiraProvider()), io, g.git),
    ).rejects.toThrow(/no jira\.projectKey/)
  })

  it('without --from-hook, missing projectKey throws an actionable error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jira-pick-throw-'))
    const path = join(dir, 'rando.config.json')
    writeFileSync(
      path,
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando',
        domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
      }),
    )
    const io = captureIo()
    const g = fakeGit({ __branch: 'feat-x' })
    await expect(
      runPick(['pick', '--config', path], mockAdapters(jiraProvider()), io, g.git),
    ).rejects.toThrow(/No Jira project key/)
  })
})
