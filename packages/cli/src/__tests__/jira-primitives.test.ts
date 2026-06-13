import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../cli'
import type { Adapters } from '../config'
import type { JiraIssue, JiraProvider } from '../domain/jira'
import { captureIo } from './helpers'

function mockAdapters(jira: JiraProvider): Adapters {
  const never = (() => {
    throw new Error('not expected to be called')
  }) as never
  return {
    db: never,
    tunnel: never,
    dns: never,
    deploy: never,
    jira: () => jira,
  }
}

const noExit = () => {
  throw new Error('unexpected process.exit')
}

const STATUS_IN_PROGRESS = { id: '2', name: 'In Progress', category: 'indeterminate' as const }
const STATUS_DONE = { id: '3', name: 'Done', category: 'done' as const }

const ISSUE: JiraIssue = {
  key: 'RANDO-7',
  id: 'i_7',
  summary: 'Add search/sort',
  status: STATUS_IN_PROGRESS,
  assignee: { accountId: 'acct_1', displayName: 'Newton' },
  updated: '2026-06-13T00:00:00Z',
}

const TRANSITIONS = [
  { id: '11', name: 'Start progress', to: STATUS_IN_PROGRESS },
  { id: '21', name: 'Done', to: STATUS_DONE },
]

function jiraProvider(overrides: Partial<JiraProvider> = {}): JiraProvider {
  return {
    getMyself: vi.fn(),
    getProject: vi.fn(),
    listStatuses: vi.fn(),
    listTransitions: vi.fn(async () => TRANSITIONS),
    searchIssues: vi.fn(async () => [ISSUE]),
    getIssue: vi.fn(async () => ISSUE),
    createIssue: vi.fn(async () => ({ key: 'RANDO-99' })),
    transitionIssue: vi.fn(),
    addComment: vi.fn(),
    ...overrides,
  }
}

function writeConfigWithJira(projectKey = 'RANDO') {
  const dir = mkdtempSync(join(tmpdir(), 'jira-prim-'))
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

// --- list ----------------------------------------------------------------

describe('jira list', () => {
  it('defaults to open issues in the configured project (no --mine)', async () => {
    const path = writeConfigWithJira('RANDO')
    const jira = jiraProvider()
    const io = captureIo()
    await run(['jira', 'list', '--config', path], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit: noExit,
    })
    expect(jira.searchIssues).toHaveBeenCalledWith({
      projectKey: 'RANDO',
      openOnly: true,
      limit: 50,
    })
    expect(io.stdout.join('\n')).toContain('RANDO-7')
    expect(io.stdout.join('\n')).toContain('Add search/sort')
  })

  it('--mine adds the currentUser assignee filter', async () => {
    const path = writeConfigWithJira()
    const jira = jiraProvider()
    const io = captureIo()
    await run(['jira', 'list', '--mine', '--config', path], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit: noExit,
    })
    expect(jira.searchIssues).toHaveBeenCalledWith({
      projectKey: 'RANDO',
      openOnly: true,
      limit: 50,
      assignee: 'currentUser',
    })
  })

  it('--all drops the openOnly filter', async () => {
    const path = writeConfigWithJira()
    const jira = jiraProvider()
    await run(['jira', 'list', '--all', '--config', path], {
      adapters: mockAdapters(jira),
      io: captureIo().io,
      exit: noExit,
    })
    expect(jira.searchIssues).toHaveBeenCalledWith({
      projectKey: 'RANDO',
      openOnly: false,
      limit: 50,
    })
  })

  it('--project overrides rando.config.json', async () => {
    const path = writeConfigWithJira('RANDO')
    const jira = jiraProvider()
    await run(['jira', 'list', '--project', 'OTHER', '--config', path], {
      adapters: mockAdapters(jira),
      io: captureIo().io,
      exit: noExit,
    })
    expect((jira.searchIssues as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      projectKey: 'OTHER',
    })
  })

  it('--json emits raw JSON instead of a table', async () => {
    const path = writeConfigWithJira()
    const io = captureIo()
    await run(['jira', 'list', '--json', '--config', path], {
      adapters: mockAdapters(jiraProvider()),
      io: io.io,
      exit: noExit,
    })
    expect(JSON.parse(io.stdout.join(''))).toEqual([ISSUE])
  })

  it('passes projectKey=undefined when config has no jira block', async () => {
    // No --config and no config in cwd → projectKey undefined → server-wide list.
    const jira = jiraProvider()
    await run(['jira', 'list'], {
      adapters: mockAdapters(jira),
      io: captureIo().io,
      exit: noExit,
    })
    expect((jira.searchIssues as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      projectKey: undefined,
    })
  })
})

// --- show ----------------------------------------------------------------

describe('jira show', () => {
  it('GETs the issue and prints a summary block', async () => {
    const jira = jiraProvider()
    const io = captureIo()
    await run(['jira', 'show', 'RANDO-7'], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit: noExit,
    })
    expect(jira.getIssue).toHaveBeenCalledWith('RANDO-7')
    const out = io.stdout.join('\n')
    expect(out).toContain('RANDO-7')
    expect(out).toContain('Add search/sort')
    expect(out).toContain('In Progress')
    expect(out).toContain('Newton')
  })

  it('renders "unassigned" when assignee is null', async () => {
    const jira = jiraProvider({
      getIssue: vi.fn(async () => ({ ...ISSUE, assignee: null })),
    })
    const io = captureIo()
    await run(['jira', 'show', 'RANDO-7'], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit: noExit,
    })
    expect(io.stdout.join('\n')).toContain('unassigned')
  })

  it('--json emits raw JSON', async () => {
    const io = captureIo()
    await run(['jira', 'show', 'RANDO-7', '--json'], {
      adapters: mockAdapters(jiraProvider()),
      io: io.io,
      exit: noExit,
    })
    expect(JSON.parse(io.stdout.join(''))).toEqual(ISSUE)
  })
})

// --- create --------------------------------------------------------------

describe('jira create', () => {
  it('creates an issue in the configured project with the given summary', async () => {
    const path = writeConfigWithJira('RANDO')
    const jira = jiraProvider()
    const io = captureIo()
    await run(['jira', 'create', 'Add search', '--config', path], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit: noExit,
    })
    expect(jira.createIssue).toHaveBeenCalledWith({
      projectKey: 'RANDO',
      summary: 'Add search',
      description: undefined,
      issueType: undefined,
    })
    expect(io.stdout.join('\n')).toContain('created RANDO-99')
  })

  it('threads --description and --type through', async () => {
    const path = writeConfigWithJira('RANDO')
    const jira = jiraProvider()
    await run(
      [
        'jira',
        'create',
        'Investigate flake',
        '--description',
        'PR #42',
        '--type',
        'Bug',
        '--config',
        path,
      ],
      { adapters: mockAdapters(jira), io: captureIo().io, exit: noExit },
    )
    expect(jira.createIssue).toHaveBeenCalledWith({
      projectKey: 'RANDO',
      summary: 'Investigate flake',
      description: 'PR #42',
      issueType: 'Bug',
    })
  })

  it('exits non-zero with a clear error when no project key is available', async () => {
    const jira = jiraProvider()
    const io = captureIo()
    const exit = vi.fn() as unknown as (code: number) => never
    await run(['jira', 'create', 'X'], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit,
    })
    expect(exit).toHaveBeenCalledWith(1)
    expect(io.stderr.join('\n')).toMatch(/No Jira project key/)
    expect(jira.createIssue).not.toHaveBeenCalled()
  })
})

// --- transition ----------------------------------------------------------

describe('jira transition', () => {
  it('resolves a transition by name (case-insensitive) and executes it', async () => {
    const jira = jiraProvider()
    const io = captureIo()
    await run(['jira', 'transition', 'RANDO-7', 'start PROGRESS'], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit: noExit,
    })
    expect(jira.transitionIssue).toHaveBeenCalledWith({
      issueKey: 'RANDO-7',
      transitionId: '11',
    })
    expect(io.stdout.join('\n')).toContain('RANDO-7 → In Progress')
  })

  it('resolves a transition by id', async () => {
    const jira = jiraProvider()
    await run(['jira', 'transition', 'RANDO-7', '21'], {
      adapters: mockAdapters(jira),
      io: captureIo().io,
      exit: noExit,
    })
    expect(jira.transitionIssue).toHaveBeenCalledWith({
      issueKey: 'RANDO-7',
      transitionId: '21',
    })
  })

  it('exits non-zero when the transition does not match any available one', async () => {
    const jira = jiraProvider()
    const io = captureIo()
    const exit = vi.fn() as unknown as (code: number) => never
    await run(['jira', 'transition', 'RANDO-7', 'Unknown'], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit,
    })
    // Non-TTY pickOr falls through to the "missing argument" path because
    // resolveTransitionId returned undefined for 'Unknown'.
    expect(exit).toHaveBeenCalled()
    expect(io.stderr.join('\n')).toMatch(/Missing required argument <transition>/)
    expect(jira.transitionIssue).not.toHaveBeenCalled()
  })
})

// --- comment -------------------------------------------------------------

describe('jira comment', () => {
  it('joins variadic body args with spaces', async () => {
    const jira = jiraProvider()
    const io = captureIo()
    await run(['jira', 'comment', 'RANDO-7', 'Deployed', 'to', 'https://staging-web.example.com'], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit: noExit,
    })
    expect(jira.addComment).toHaveBeenCalledWith({
      issueKey: 'RANDO-7',
      body: 'Deployed to https://staging-web.example.com',
    })
    expect(io.stdout.join('\n')).toContain('commented on RANDO-7')
  })
})
