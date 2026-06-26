// Tests for the `rando issues` command surface (commands/issues.ts).
// Mocks the IssueTrackerProvider directly so vendor specifics don't
// leak into command-level tests — the adapter-specific tests
// (jira-cloud.test.ts, github-issues.test.ts) cover those separately.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'
import type { Adapters } from '../config'
import type { Issue, IssueTrackerProvider } from '../domain/tracker'
import { MissingConfigError } from '../domain/errors'
import type { GitRunner } from '../git'
import { issuesCommand } from '../commands/issues'
import { captureIo } from './helpers'

// ─── fixtures ─────────────────────────────────────────────────────────

const FIELD = '\x1f'
const RECORD = '\x1e'

const ISSUE: Issue = {
  key: '#7',
  id: 'i_7',
  summary: 'Add search/sort',
  status: 'open',
  statusCategory: 'open',
  assignee: { id: 'newton', displayName: 'Newton' },
  updated: '2026-06-13T00:00:00Z',
  url: 'https://github.com/rando-id/rando.id/issues/7',
}

function provider(overrides: Partial<IssueTrackerProvider> = {}): IssueTrackerProvider {
  return {
    getMyself: vi.fn(async () => ({ id: 'newton', displayName: 'Newton' })),
    searchIssues: vi.fn(async () => [ISSUE]),
    getIssue: vi.fn(async () => ISSUE),
    createIssue: vi.fn(async () => ({ key: '#99' })),
    applyLifecycle: vi.fn(async () => ({
      transitioned: true,
      status: 'open + status:in-progress',
      via: 'label set to status:in-progress',
    })),
    addComment: vi.fn(),
    doctor: vi.fn(async () => ({
      authedAs: 'Newton (newton)',
      projectLabel: 'Repo: rando-id/rando.id',
      statuses: [{ name: 'open', category: 'open' as const }],
      lifecycle: [
        {
          slot: 'inProgress' as const,
          value: 'status:in-progress',
          resolved: true,
          note: 'label exists',
        },
        {
          slot: 'inReview' as const,
          value: 'status:in-review',
          resolved: false,
          note: '(missing)',
        },
        {
          slot: 'done' as const,
          value: 'closed',
          resolved: true,
          note: '(intrinsic)',
        },
      ],
    })),
    ...overrides,
  }
}

function mockAdapters(trackerFactory: (() => IssueTrackerProvider) | (() => never)): Adapters {
  const never = (() => {
    throw new Error('not expected to be called')
  }) as never
  return {
    db: never,
    tunnel: never,
    dns: never,
    deploy: never,
    tracker: trackerFactory,
    apiTesting: never,
    postman: never,
    secrets: never,
    gh: never,
    ghAdmin: never,
    vercelCli: never,
  }
}

function gitWithCommits(commits: Array<[string, string, string, string]>): GitRunner {
  const out =
    commits
      .map(([sha, date, subject, body]) => [sha, date, subject, body].join(FIELD))
      .join(RECORD) + RECORD
  return { run: () => out }
}

function fakeGitConfig(state: Record<string, string | null> = {}): {
  git: GitRunner
  state: Record<string, string | null>
} {
  const config: Record<string, string | null> = { ...state }
  return {
    git: {
      run(args) {
        if (args[0] === 'rev-parse') return config['__branch'] ?? 'feat-x'
        if (args[0] === 'config' && args[1] === '--replace-all') {
          config[args[2] ?? ''] = args[3] ?? ''
          return ''
        }
        if (args[0] === 'config' && args[1] === '--unset') {
          delete config[args[2] ?? '']
          return ''
        }
        if (args[0] === 'config') return config[args[1] ?? ''] ?? null
        if (args[0] === 'log') return ''
        return null
      },
    },
    state: config,
  }
}

function writeConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), 'issues-test-'))
  const path = join(dir, 'rando.config.json')
  writeFileSync(
    path,
    JSON.stringify({
      project: 'rando',
      repo: 'rando-id/rando.id',
      domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
      apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
      tracker: { kind: 'github' },
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

async function run(
  args: string[],
  adapters: Adapters,
  io: ReturnType<typeof captureIo>,
  git: GitRunner,
) {
  const program = new Command().exitOverride()
  program.addCommand(issuesCommand(adapters, io.io, { git }))
  await program.parseAsync(['node', 'rando', 'issues', ...args])
}

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

// ─── pick ─────────────────────────────────────────────────────────────

describe('issues pick', () => {
  it('caches the picked key in git config', async () => {
    const p = provider()
    const io = captureIo({ selectResponses: ['#7'] })
    const g = fakeGitConfig({ __branch: 'feat-search' })
    await run(
      ['pick'],
      mockAdapters(() => p),
      io,
      g.git,
    )
    expect(g.state['branch.feat-search.jira-key']).toBe('#7')
    expect(io.stdout.join('\n')).toContain('#7 cached for branch feat-search')
  })

  it('caches the "skip" sentinel when the user picks Skip', async () => {
    const p = provider()
    const io = captureIo({ selectResponses: ['__skip__'] })
    const g = fakeGitConfig({ __branch: 'feat-skip' })
    await run(
      ['pick'],
      mockAdapters(() => p),
      io,
      g.git,
    )
    expect(g.state['branch.feat-skip.jira-key']).toBe('skip')
    expect(io.stdout.join('\n')).toContain('skipped')
  })

  it('creates a new issue when "+ Create" is picked', async () => {
    const p = provider()
    const io = captureIo({
      selectResponses: ['__create_new__'],
      inputResponses: ['Brand new'],
    })
    const g = fakeGitConfig({ __branch: 'feat-new' })
    await withTty(true, () =>
      run(
        ['pick'],
        mockAdapters(() => p),
        io,
        g.git,
      ),
    )
    expect(p.createIssue).toHaveBeenCalledWith({ summary: 'Brand new' })
    expect(g.state['branch.feat-new.jira-key']).toBe('#99')
  })

  it('exits early when the branch is already cached (no --from-hook)', async () => {
    const p = provider()
    const io = captureIo()
    const g = fakeGitConfig({
      __branch: 'feat-cached',
      'branch.feat-cached.jira-key': '#5',
    })
    await run(
      ['pick'],
      mockAdapters(() => p),
      io,
      g.git,
    )
    expect(p.searchIssues).not.toHaveBeenCalled()
    expect(io.stdout.join('\n')).toContain('already cached: #5')
  })

  it('--from-hook silently exits when the branch is already cached', async () => {
    const p = provider()
    const io = captureIo()
    const g = fakeGitConfig({
      __branch: 'feat-cached',
      'branch.feat-cached.jira-key': '#5',
    })
    await run(
      ['pick', '--from-hook'],
      mockAdapters(() => p),
      io,
      g.git,
    )
    expect(io.stdout).toEqual([])
  })

  it('--reset clears the cached key', async () => {
    const io = captureIo()
    const g = fakeGitConfig({
      __branch: 'feat-reset',
      'branch.feat-reset.jira-key': '#5',
    })
    await run(
      ['pick', '--reset'],
      mockAdapters(() => provider()),
      io,
      g.git,
    )
    expect(g.state['branch.feat-reset.jira-key']).toBeUndefined()
    expect(io.stdout.join('\n')).toContain('cleared cached ticket')
  })

  it('exits cleanly when detached HEAD', async () => {
    const io = captureIo()
    const g = fakeGitConfig({ __branch: 'HEAD' })
    await run(
      ['pick'],
      mockAdapters(() => provider()),
      io,
      g.git,
    )
    expect(io.stderr.join('\n')).toContain('no current branch')
  })

  it('--from-hook softens MissingConfigError into a no-op', async () => {
    const io = captureIo()
    const g = fakeGitConfig({ __branch: 'feat-x' })
    const adapters = mockAdapters(() => {
      throw new MissingConfigError('GITHUB_TOKEN', 'github')
    })
    await run(['pick', '--from-hook'], adapters, io, g.git)
    expect(io.stderr.join('\n')).toContain('tracker not configured')
    expect(g.state['branch.feat-x.jira-key']).toBeUndefined()
  })

  it('without --from-hook, missing tracker throws', async () => {
    const io = captureIo()
    const g = fakeGitConfig({ __branch: 'feat-x' })
    const adapters = mockAdapters(() => {
      throw new MissingConfigError('GITHUB_TOKEN', 'github')
    })
    await expect(run(['pick'], adapters, io, g.git)).rejects.toThrow(/GITHUB_TOKEN/)
  })

  it('--check exits silently when tracker is configured', async () => {
    const io = captureIo()
    const g = fakeGitConfig()
    await run(
      ['pick', '--check'],
      mockAdapters(() => provider()),
      io,
      g.git,
    )
    expect(io.stdout).toEqual([])
    expect(io.stderr).toEqual([])
  })

  it('--check throws when tracker factory throws', async () => {
    const io = captureIo()
    const g = fakeGitConfig()
    const adapters = mockAdapters(() => {
      throw new MissingConfigError('GITHUB_TOKEN', 'github')
    })
    await expect(run(['pick', '--check'], adapters, io, g.git)).rejects.toThrow(/not configured/)
  })

  function writeConfigWithProtected(protectedBranches: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'pick-protected-'))
    const path = join(dir, 'rando.config.json')
    writeFileSync(
      path,
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando.id',
        domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
        tracker: { kind: 'github', protectedBranches },
      }),
    )
    return path
  }

  it('re-prompts on protected branch even when a key is cached', async () => {
    const configPath = writeConfigWithProtected(['main'])
    const p = provider()
    const io = captureIo({ selectResponses: ['#42'] })
    const g = fakeGitConfig({ __branch: 'main', 'branch.main.jira-key': '#58' })
    await run(
      ['pick', '--config', configPath],
      mockAdapters(() => p),
      io,
      g.git,
    )
    // Despite the cached #58, the picker prompted and overwrote with #42.
    expect(p.searchIssues).toHaveBeenCalled()
    expect(g.state['branch.main.jira-key']).toBe('#42')
    // User sees a note about why they were re-prompted.
    expect(io.stdout.join('\n')).toMatch(/protected/)
  })

  it('--from-hook on protected branch also re-prompts (no silent skip)', async () => {
    const configPath = writeConfigWithProtected(['main'])
    const p = provider()
    const io = captureIo({ selectResponses: ['#7'] })
    const g = fakeGitConfig({ __branch: 'main', 'branch.main.jira-key': '#58' })
    await run(
      ['pick', '--from-hook', '--config', configPath],
      mockAdapters(() => p),
      io,
      g.git,
    )
    expect(p.searchIssues).toHaveBeenCalled()
    expect(g.state['branch.main.jira-key']).toBe('#7')
  })

  it('defaults to ALL open issues (assignee filter NOT applied)', async () => {
    const p = provider()
    const io = captureIo({ selectResponses: ['#7'] })
    const g = fakeGitConfig({ __branch: 'feat-scope' })
    await run(
      ['pick'],
      mockAdapters(() => p),
      io,
      g.git,
    )
    // Searches without `assignee` so unassigned + assigned-to-others issues show up.
    expect(p.searchIssues).toHaveBeenCalledWith(
      expect.not.objectContaining({ assignee: expect.anything() as unknown }),
    )
    expect(p.searchIssues).toHaveBeenCalledWith(expect.objectContaining({ openOnly: true }))
  })

  it('--mine narrows to issues assigned to current user', async () => {
    const p = provider()
    const io = captureIo({ selectResponses: ['#7'] })
    const g = fakeGitConfig({ __branch: 'feat-scope' })
    await run(
      ['pick', '--mine'],
      mockAdapters(() => p),
      io,
      g.git,
    )
    expect(p.searchIssues).toHaveBeenCalledWith(
      expect.objectContaining({ assignee: 'currentUser', openOnly: true }),
    )
  })

  it('non-protected branch with cache still short-circuits (no regression)', async () => {
    const configPath = writeConfigWithProtected(['main', 'master'])
    const p = provider()
    const io = captureIo()
    const g = fakeGitConfig({ __branch: 'feat/foo', 'branch.feat/foo.jira-key': '#5' })
    await run(
      ['pick', '--config', configPath],
      mockAdapters(() => p),
      io,
      g.git,
    )
    expect(p.searchIssues).not.toHaveBeenCalled()
    expect(io.stdout.join('\n')).toContain('already cached')
  })
})

// ─── refs ─────────────────────────────────────────────────────────────

describe('issues refs', () => {
  it('extracts and dedupes Refs: keys from a commit range', async () => {
    const g = gitWithCommits([
      ['a'.repeat(40), '2026-06-13T00:00:00Z', 'feat: x', 'Refs: #1'],
      ['b'.repeat(40), '2026-06-12T00:00:00Z', 'feat: y', 'Refs: #2'],
      ['c'.repeat(40), '2026-06-11T00:00:00Z', 'feat: z', 'Refs: #1'], // dup
    ])
    const io = captureIo()
    // Note: parseJiraRefs only matches PROJ-N (uppercase, dash, digits).
    // GitHub-style "#N" footers wouldn't match — for this test we use
    // Jira-style keys to exercise the dedupe path.
    const gWithJira = gitWithCommits([
      ['a'.repeat(40), '2026-06-13T00:00:00Z', 'feat: x', 'Refs: RANDO-1'],
      ['b'.repeat(40), '2026-06-12T00:00:00Z', 'feat: y', 'Refs: RANDO-2'],
      ['c'.repeat(40), '2026-06-11T00:00:00Z', 'feat: z', 'Refs: RANDO-1'],
    ])
    await run(
      ['refs', 'main..HEAD'],
      mockAdapters(() => provider()),
      io,
      gWithJira,
    )
    expect(io.stdout.join('\n')).toBe('RANDO-1\nRANDO-2')
    // Suppress unused-var lint on the placeholder gh-style git stub.
    void g
  })

  it('emits an empty result for commits without Refs footers', async () => {
    const g = gitWithCommits([['a'.repeat(40), '2026-06-13T00:00:00Z', 'feat', 'no footer']])
    const io = captureIo()
    await run(
      ['refs', 'main..HEAD'],
      mockAdapters(() => provider()),
      io,
      g,
    )
    expect(io.stdout.join('')).toBe('')
  })

  it('--json emits an array', async () => {
    const g = gitWithCommits([['a'.repeat(40), '2026-06-13T00:00:00Z', 's', 'Refs: RANDO-1']])
    const io = captureIo()
    await run(
      ['refs', 'main..HEAD', '--json'],
      mockAdapters(() => provider()),
      io,
      g,
    )
    expect(JSON.parse(io.stdout.join(''))).toEqual(['RANDO-1'])
  })
})

// ─── list ─────────────────────────────────────────────────────────────

describe('issues list', () => {
  it('defaults to open issues, prints a table', async () => {
    const p = provider()
    const io = captureIo()
    await run(
      ['list'],
      mockAdapters(() => p),
      io,
      fakeGitConfig().git,
    )
    expect(p.searchIssues).toHaveBeenCalledWith({ openOnly: true, limit: 50 })
    expect(io.stdout.join('\n')).toContain('#7')
    expect(io.stdout.join('\n')).toContain('Add search/sort')
  })

  it('--mine adds the currentUser assignee filter', async () => {
    const p = provider()
    await run(
      ['list', '--mine'],
      mockAdapters(() => p),
      captureIo(),
      fakeGitConfig().git,
    )
    expect(p.searchIssues).toHaveBeenCalledWith({
      openOnly: true,
      limit: 50,
      assignee: 'currentUser',
    })
  })

  it('--all drops openOnly', async () => {
    const p = provider()
    await run(
      ['list', '--all'],
      mockAdapters(() => p),
      captureIo(),
      fakeGitConfig().git,
    )
    expect(p.searchIssues).toHaveBeenCalledWith({ openOnly: false, limit: 50 })
  })

  it('--json emits raw JSON', async () => {
    const io = captureIo()
    await run(
      ['list', '--json'],
      mockAdapters(() => provider()),
      io,
      fakeGitConfig().git,
    )
    expect(JSON.parse(io.stdout.join(''))).toEqual([ISSUE])
  })
})

// ─── show ─────────────────────────────────────────────────────────────

describe('issues show', () => {
  it('prints summary block including url', async () => {
    const io = captureIo()
    await run(
      ['show', '#7'],
      mockAdapters(() => provider()),
      io,
      fakeGitConfig().git,
    )
    const out = io.stdout.join('\n')
    expect(out).toContain('#7')
    expect(out).toContain('Add search/sort')
    expect(out).toContain('https://github.com/rando-id/rando.id/issues/7')
  })

  it('shows "unassigned" when assignee is null', async () => {
    const p = provider({ getIssue: vi.fn(async () => ({ ...ISSUE, assignee: null })) })
    const io = captureIo()
    await run(
      ['show', '#7'],
      mockAdapters(() => p),
      io,
      fakeGitConfig().git,
    )
    expect(io.stdout.join('\n')).toContain('unassigned')
  })

  it('--json emits raw JSON', async () => {
    const io = captureIo()
    await run(
      ['show', '#7', '--json'],
      mockAdapters(() => provider()),
      io,
      fakeGitConfig().git,
    )
    expect(JSON.parse(io.stdout.join(''))).toEqual(ISSUE)
  })
})

// ─── create ──────────────────────────────────────────────────────────

describe('issues create', () => {
  it('creates with summary + description + labels', async () => {
    const p = provider()
    const io = captureIo()
    await run(
      ['create', 'Add search', '-d', 'body', '--label', 'enhancement', '--label', 'web'],
      mockAdapters(() => p),
      io,
      fakeGitConfig().git,
    )
    expect(p.createIssue).toHaveBeenCalledWith({
      summary: 'Add search',
      description: 'body',
      labels: ['enhancement', 'web'],
    })
    expect(io.stdout.join('\n')).toContain('created #99')
  })

  it('--json emits raw JSON', async () => {
    const io = captureIo()
    await run(
      ['create', 'X', '--json'],
      mockAdapters(() => provider()),
      io,
      fakeGitConfig().git,
    )
    expect(JSON.parse(io.stdout.join(''))).toEqual({ key: '#99' })
  })

  it('threads --milestone through to createIssue', async () => {
    const p = provider()
    await run(
      ['create', 'X', '-m', 'v0.1 — Feature parity'],
      mockAdapters(() => p),
      captureIo(),
      fakeGitConfig().git,
    )
    const call = (p.createIssue as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(call?.milestone).toBe('v0.1 — Feature parity')
  })
})

// ─── comment ─────────────────────────────────────────────────────────

describe('issues comment', () => {
  it('joins variadic body args', async () => {
    const p = provider()
    const io = captureIo()
    await run(
      ['comment', '#7', 'Deployed', 'to', 'https://x.dev'],
      mockAdapters(() => p),
      io,
      fakeGitConfig().git,
    )
    expect(p.addComment).toHaveBeenCalledWith({
      key: '#7',
      body: 'Deployed to https://x.dev',
    })
    expect(io.stdout.join('\n')).toContain('commented on #7')
  })
})

// ─── lifecycle ───────────────────────────────────────────────────────

describe('issues lifecycle', () => {
  it('passes the slot through and prints success when transitioned', async () => {
    const p = provider()
    const io = captureIo()
    await run(
      ['lifecycle', '#7', 'in-progress'],
      mockAdapters(() => p),
      io,
      fakeGitConfig().git,
    )
    expect(p.applyLifecycle).toHaveBeenCalledWith({ key: '#7', slot: 'inProgress' })
    expect(io.stdout.join('\n')).toContain('#7 → open + status:in-progress')
  })

  it('renders "already at" when transitioned=false', async () => {
    const p = provider({
      applyLifecycle: vi.fn(async () => ({
        transitioned: false,
        status: 'closed',
        via: 'already closed',
      })),
    })
    const io = captureIo()
    await run(
      ['lifecycle', '#7', 'done'],
      mockAdapters(() => p),
      io,
      fakeGitConfig().git,
    )
    expect(io.stdout.join('\n')).toMatch(/already at closed/)
  })

  it('--message posts a comment alongside the transition', async () => {
    const p = provider()
    await run(
      ['lifecycle', '#7', 'in-review', '-m', 'deploy: https://x.dev'],
      mockAdapters(() => p),
      captureIo(),
      fakeGitConfig().git,
    )
    expect(p.addComment).toHaveBeenCalledWith({
      key: '#7',
      body: 'deploy: https://x.dev',
    })
    expect(p.applyLifecycle).toHaveBeenCalled()
  })

  it('throws on an invalid slot', async () => {
    const p = provider()
    const io = captureIo()
    await expect(
      run(
        ['lifecycle', '#7', 'bogus'],
        mockAdapters(() => p),
        io,
        fakeGitConfig().git,
      ),
    ).rejects.toThrow(/Invalid lifecycle slot/)
  })

  it('accepts slot variants (in-progress / inProgress / inprogress)', async () => {
    const p = provider()
    await run(
      ['lifecycle', '#7', 'inProgress'],
      mockAdapters(() => p),
      captureIo(),
      fakeGitConfig().git,
    )
    expect(p.applyLifecycle).toHaveBeenCalledWith({ key: '#7', slot: 'inProgress' })
  })
})

// ─── backfill ────────────────────────────────────────────────────────

describe('issues backfill', () => {
  it('dry-run prints the plan without touching the tracker', async () => {
    const p = provider()
    const path = writeConfig()
    const g = gitWithCommits([
      ['a'.repeat(40), '2026-06-13T00:00:00Z', 'feat: x', ''],
      ['b'.repeat(40), '2026-06-12T00:00:00Z', 'chore: docs', ''],
    ])
    const io = captureIo()
    await run(
      ['backfill', '--config', path],
      mockAdapters(() => p),
      io,
      g,
    )
    expect(p.createIssue).not.toHaveBeenCalled()
    const out = io.stdout.join('\n')
    expect(out).toContain('Would create 2 issues')
    expect(out).toContain('feat: x')
    expect(out).toContain('--apply')
  })

  it('--apply creates one issue per commit and transitions each to done', async () => {
    const p = provider()
    const path = writeConfig()
    const g = gitWithCommits([['a'.repeat(40), '2026-06-13T00:00:00Z', 'feat: x', 'with body']])
    const io = captureIo()
    await run(
      ['backfill', '--apply', '--config', path],
      mockAdapters(() => p),
      io,
      g,
    )
    expect(p.createIssue).toHaveBeenCalledTimes(1)
    const call = (p.createIssue as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(call.summary).toBe('feat: x')
    expect(call.labels).toEqual(['backfill'])
    expect(call.description).toContain('Backfilled from git commit aaaaaaa')
    expect(p.applyLifecycle).toHaveBeenCalledWith({ key: '#99', slot: 'done' })
    expect(io.stdout.join('\n')).toContain('1/1 issue created')
  })

  it('--label swaps the backfill label', async () => {
    const p = provider()
    const path = writeConfig()
    const g = gitWithCommits([['a'.repeat(40), '2026-06-13T00:00:00Z', 's', '']])
    await run(
      ['backfill', '--apply', '--label', 'historical', '--config', path],
      mockAdapters(() => p),
      captureIo(),
      g,
    )
    const call = (p.createIssue as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(call.labels).toEqual(['historical'])
  })

  it('continues after a per-commit failure and reports the count', async () => {
    let n = 0
    const p = provider({
      createIssue: vi.fn(async () => {
        if (n++ === 0) throw new Error('API 500')
        return { key: '#100' }
      }),
    })
    const path = writeConfig()
    const g = gitWithCommits([
      ['a'.repeat(40), '2026-06-13T00:00:00Z', 'one', ''],
      ['b'.repeat(40), '2026-06-12T00:00:00Z', 'two', ''],
    ])
    const io = captureIo()
    await run(
      ['backfill', '--apply', '--config', path],
      mockAdapters(() => p),
      io,
      g,
    )
    const out = io.stdout.join('\n')
    expect(out).toContain('API 500')
    expect(out).toContain('1/2 issues created')
    expect(out).toContain('(1 failure)')
  })

  it('reports the no-commits case cleanly', async () => {
    const path = writeConfig()
    const io = captureIo()
    await run(
      ['backfill', '--config', path],
      mockAdapters(() => provider()),
      io,
      { run: () => '' },
    )
    expect(io.stdout.join('\n')).toContain('no commits to backfill')
  })

  it('renders no-op lifecycle results in the apply log', async () => {
    const p = provider({
      applyLifecycle: vi.fn(async () => ({
        transitioned: false,
        status: 'closed',
        via: 'already closed',
      })),
    })
    const path = writeConfig()
    const g = gitWithCommits([['a'.repeat(40), '2026-06-13T00:00:00Z', 's', '']])
    const io = captureIo()
    await run(
      ['backfill', '--apply', '--config', path],
      mockAdapters(() => p),
      io,
      g,
    )
    expect(io.stdout.join('\n')).toContain('closed')
  })
})

// ─── doctor ──────────────────────────────────────────────────────────

describe('issues doctor', () => {
  it('renders the report from the adapter', async () => {
    const p = provider()
    const io = captureIo()
    await run(
      ['doctor'],
      mockAdapters(() => p),
      io,
      fakeGitConfig().git,
    )
    expect(io.spinners[0]?.text).toContain('Authenticated as Newton')
    const out = io.stdout.join('\n')
    expect(out).toContain('Repo: rando-id/rando.id')
    expect(out).toContain('Statuses:')
    expect(out).toContain('Lifecycle map:')
    expect(out).toContain('inProgress')
    expect(out).toContain('inReview')
  })

  it('--json appends the structured report after the human render', async () => {
    const p = provider()
    const io = captureIo()
    await run(
      ['doctor', '--json'],
      mockAdapters(() => p),
      io,
      fakeGitConfig().git,
    )
    // The last stdout line is the JSON dump.
    const json = JSON.parse(io.stdout[io.stdout.length - 1] ?? '{}')
    expect(json.projectLabel).toBe('Repo: rando-id/rando.id')
  })

  it('surfaces auth failures via the spinner', async () => {
    const p = provider({
      doctor: vi.fn(async () => {
        throw new Error('401 unauthorized')
      }),
    })
    const io = captureIo()
    await expect(
      run(
        ['doctor'],
        mockAdapters(() => p),
        io,
        fakeGitConfig().git,
      ),
    ).rejects.toThrow(/401/)
    expect(io.spinners[0]?.events.some((e) => e.type === 'fail')).toBe(true)
  })
})
