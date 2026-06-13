import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../cli'
import type { Adapters } from '../config'
import type { JiraProvider } from '../domain/jira'
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

function writeConfig(jira: { projectKey?: string; transitions?: Record<string, string> } | null) {
  const dir = mkdtempSync(join(tmpdir(), 'jira-doctor-'))
  const path = join(dir, 'rando.config.json')
  writeFileSync(
    path,
    JSON.stringify({
      project: 'rando',
      repo: 'rando-id/rando',
      domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
      apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
      ...(jira ? { jira } : {}),
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

const RANDO_PROJECT = { id: '10001', key: 'RANDO', name: 'Rando' }
const STATUS_TODO = { id: '1', name: 'To Do', category: 'new' as const }
const STATUS_IN_PROGRESS = { id: '2', name: 'In Progress', category: 'indeterminate' as const }
const STATUS_STAGING = { id: '5', name: 'On Staging', category: 'indeterminate' as const }
const STATUS_DONE = { id: '3', name: 'Done', category: 'done' as const }

const TRANSITIONS = [
  { id: '11', name: 'Start progress', to: STATUS_IN_PROGRESS },
  { id: '12', name: 'Deploy to staging', to: STATUS_STAGING },
  { id: '21', name: 'Done', to: STATUS_DONE },
]

function jiraProvider(overrides: Partial<JiraProvider> = {}): JiraProvider {
  return {
    getMyself: vi.fn(async () => ({
      accountId: 'acct_1',
      displayName: 'Newton',
      emailAddress: 'n@example.com',
    })),
    getProject: vi.fn(async () => RANDO_PROJECT),
    listStatuses: vi.fn(async () => [STATUS_TODO, STATUS_IN_PROGRESS, STATUS_STAGING, STATUS_DONE]),
    listTransitions: vi.fn(async () => TRANSITIONS),
    searchIssues: vi.fn(async () => [
      {
        key: 'RANDO-1',
        id: 'i_1',
        summary: 'sample',
        status: STATUS_IN_PROGRESS,
        assignee: null,
        updated: '2026-06-13T00:00:00Z',
      },
    ]),
    getIssue: vi.fn(),
    createIssue: vi.fn(),
    transitionIssue: vi.fn(),
    addComment: vi.fn(),
    ...overrides,
  }
}

describe('jira doctor', () => {
  it('verifies auth, prints project + statuses, and resolves lifecycle by transition name', async () => {
    const path = writeConfig({
      projectKey: 'RANDO',
      transitions: {
        inProgress: 'Start progress',
        inReview: 'Deploy to staging',
        done: 'Done',
      },
    })
    const jira = jiraProvider()
    const io = captureIo()
    await run(['jira', 'doctor', '--config', path], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit: noExit,
    })
    const out = io.stdout.join('\n')
    // Auth success surfaces via the spinner, not stdout.
    expect(io.spinners[0]?.text).toContain('Authenticated as Newton')
    expect(out).toContain('Project: RANDO')
    expect(out).toContain('In Progress')
    expect(out).toContain('On Staging')
    // All three lifecycle slots resolve to a transition.
    expect(out).toMatch(/inProgress.*Start progress.*In Progress/)
    expect(out).toMatch(/inReview.*Deploy to staging.*On Staging/)
    expect(out).toMatch(/done.*Done.*Done/)
    // listTransitions should have been called with the issue returned by
    // the recent-search fallback.
    expect(jira.listTransitions).toHaveBeenCalledWith('RANDO-1')
  })

  it('resolves a lifecycle slot by transition id', async () => {
    const path = writeConfig({
      projectKey: 'RANDO',
      transitions: { inProgress: '11' },
    })
    const io = captureIo()
    await run(['jira', 'doctor', '--config', path], {
      adapters: mockAdapters(jiraProvider()),
      io: io.io,
      exit: noExit,
    })
    expect(io.stdout.join('\n')).toMatch(/inProgress.*11.*Start progress.*In Progress/)
  })

  it('flags an unmapped slot as "… unset"', async () => {
    const path = writeConfig({ projectKey: 'RANDO', transitions: {} })
    const io = captureIo()
    await run(['jira', 'doctor', '--config', path], {
      adapters: mockAdapters(jiraProvider()),
      io: io.io,
      exit: noExit,
    })
    const out = io.stdout.join('\n')
    expect(out).toMatch(/inProgress.*\(unset\).*… unset/)
    expect(out).toMatch(/inReview.*\(unset\).*… unset/)
    expect(out).toMatch(/done.*\(unset\).*… unset/)
  })

  it('flags a value that matches a status name (not a transition) with a "no match" note', async () => {
    const path = writeConfig({
      projectKey: 'RANDO',
      transitions: { inProgress: 'In Progress' }, // status name, not transition name
    })
    const io = captureIo()
    await run(['jira', 'doctor', '--config', path], {
      adapters: mockAdapters(jiraProvider()),
      io: io.io,
      exit: noExit,
    })
    expect(io.stdout.join('\n')).toMatch(
      /inProgress.*In Progress.*status name only — no transition matches/,
    )
  })

  it('flags a totally unmatched value with "no match in available transitions"', async () => {
    const path = writeConfig({
      projectKey: 'RANDO',
      transitions: { inProgress: 'Nonexistent' },
    })
    const io = captureIo()
    await run(['jira', 'doctor', '--config', path], {
      adapters: mockAdapters(jiraProvider()),
      io: io.io,
      exit: noExit,
    })
    expect(io.stdout.join('\n')).toMatch(/inProgress.*Nonexistent.*no match in available/)
  })

  it('warns and short-circuits when rando.config.json has no jira block', async () => {
    const path = writeConfig(null)
    const jira = jiraProvider()
    const io = captureIo()
    await run(['jira', 'doctor', '--config', path], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit: noExit,
    })
    expect(io.stdout.join('\n')).toContain('No jira.projectKey in rando.config.json')
    // No project lookup happened — auth check ran but config branch short-circuited.
    expect(jira.getProject).not.toHaveBeenCalled()
  })

  it('uses --issue when provided instead of falling back to the recent-search', async () => {
    const path = writeConfig({ projectKey: 'RANDO', transitions: {} })
    const jira = jiraProvider()
    const io = captureIo()
    await run(['jira', 'doctor', '--config', path, '--issue', 'RANDO-99'], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit: noExit,
    })
    expect(jira.searchIssues).not.toHaveBeenCalled()
    expect(jira.listTransitions).toHaveBeenCalledWith('RANDO-99')
  })

  it('handles a project with no open issues yet (no transitions section)', async () => {
    const path = writeConfig({ projectKey: 'RANDO', transitions: {} })
    const jira = jiraProvider({
      searchIssues: vi.fn(async () => []),
    })
    const io = captureIo()
    await run(['jira', 'doctor', '--config', path], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit: noExit,
    })
    expect(io.stdout.join('\n')).toContain('No open issues in the project yet')
    expect(jira.listTransitions).not.toHaveBeenCalled()
  })

  it('falls back gracefully when --config points at a missing file', async () => {
    const jira = jiraProvider()
    const io = captureIo()
    await run(['jira', 'doctor', '--config', '/nope/rando.config.json'], {
      adapters: mockAdapters(jira),
      io: io.io,
      exit: noExit,
    })
    expect(io.stderr.join('\n')).toContain("couldn't load /nope/rando.config.json")
    expect(io.stdout.join('\n')).toContain('No jira.projectKey in rando.config.json')
  })
})
