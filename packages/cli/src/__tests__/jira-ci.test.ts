// Tests for `rando jira refs <range>` and `rando jira lifecycle <KEY> <slot>`
// — the two CLI commands the GitHub Actions workflow composes.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'
import type { Adapters } from '../config'
import type { JiraIssue, JiraProvider } from '../domain/jira'
import type { GitRunner } from '../git'
import { jiraCommand } from '../commands/jira'
import { captureIo } from './helpers'

const FIELD = '\x1f'
const RECORD = '\x1e'

function mockAdapters(jira: JiraProvider): Adapters {
  const never = (() => {
    throw new Error('not expected to be called')
  }) as never
  return { db: never, tunnel: never, dns: never, deploy: never, jira: () => jira }
}

function gitWithCommits(commits: Array<[string, string, string, string]>): {
  git: GitRunner
  calls: string[][]
} {
  const calls: string[][] = []
  const out =
    commits
      .map(([sha, date, subject, body]) => [sha, date, subject, body].join(FIELD))
      .join(RECORD) + RECORD
  return {
    git: {
      run(args) {
        calls.push(args)
        if (args[0] === 'log') return out
        return ''
      },
    },
    calls,
  }
}

function writeConfig(transitions: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jira-ci-'))
  const path = join(dir, 'rando.config.json')
  writeFileSync(
    path,
    JSON.stringify({
      project: 'rando',
      repo: 'rando-id/rando',
      domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
      apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
      jira: { projectKey: 'RANDO', transitions },
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
  program.addCommand(jiraCommand(adapters, io.io, { git }))
  await program.parseAsync(['node', 'rando', 'jira', ...args])
}

// --- refs ----------------------------------------------------------------

describe('jira refs', () => {
  it('passes the range straight through to git log and prints deduped keys', async () => {
    writeConfig()
    const g = gitWithCommits([
      ['a'.repeat(40), '2026-06-13T00:00:00Z', 'feat: x', 'Refs: RANDO-1'],
      ['b'.repeat(40), '2026-06-12T00:00:00Z', 'feat: y', 'Refs: RANDO-2'],
      // Dup with the first
      ['c'.repeat(40), '2026-06-11T00:00:00Z', 'feat: z', 'Refs: RANDO-1'],
    ])
    const io = captureIo()
    await run(['refs', 'main..HEAD'], mockAdapters({} as JiraProvider), io, g.git)
    expect(g.calls[0]).toEqual(expect.arrayContaining(['log', 'main..HEAD']))
    // Text mode: one per line; order preserves first appearance.
    expect(io.stdout.join('\n')).toBe('RANDO-1\nRANDO-2')
  })

  it('handles multi-key Refs in a single commit', async () => {
    writeConfig()
    const g = gitWithCommits([
      ['a'.repeat(40), '2026-06-13T00:00:00Z', 'feat', 'Refs: RANDO-1, RANDO-2'],
    ])
    const io = captureIo()
    await run(['refs', 'main..HEAD'], mockAdapters({} as JiraProvider), io, g.git)
    expect(io.stdout.join('\n')).toBe('RANDO-1\nRANDO-2')
  })

  it('--json emits an array', async () => {
    writeConfig()
    const g = gitWithCommits([['a'.repeat(40), '2026-06-13T00:00:00Z', 's', 'Refs: RANDO-1']])
    const io = captureIo()
    await run(['refs', 'main..HEAD', '--json'], mockAdapters({} as JiraProvider), io, g.git)
    expect(JSON.parse(io.stdout.join(''))).toEqual(['RANDO-1'])
  })

  it('emits empty output when no commits have Refs footers', async () => {
    writeConfig()
    const g = gitWithCommits([
      ['a'.repeat(40), '2026-06-13T00:00:00Z', 'feat: no ref', 'just a body'],
    ])
    const io = captureIo()
    await run(['refs', 'main..HEAD'], mockAdapters({} as JiraProvider), io, g.git)
    expect(io.stdout.join('')).toBe('')
  })
})

// --- lifecycle -----------------------------------------------------------

const STATUS_TO_DO = { id: '1', name: 'To Do', category: 'new' as const }
const STATUS_IN_PROGRESS = { id: '2', name: 'In Progress', category: 'indeterminate' as const }
const STATUS_IN_REVIEW = { id: '5', name: 'In Review', category: 'indeterminate' as const }
const STATUS_DONE = { id: '3', name: 'Done', category: 'done' as const }

const FULL_TRANSITIONS = [
  { id: '11', name: 'To Do', to: STATUS_TO_DO },
  { id: '21', name: 'In Progress', to: STATUS_IN_PROGRESS },
  { id: '31', name: 'In Review', to: STATUS_IN_REVIEW },
  { id: '41', name: 'Done', to: STATUS_DONE },
]

const SAMPLE_ISSUE: JiraIssue = {
  key: 'RANDO-7',
  id: 'i_7',
  summary: 'X',
  // Start at To Do so the default "transition to in-progress" tests
  // see a real state change instead of hitting the self-loop guard.
  status: STATUS_TO_DO,
  assignee: null,
  updated: '2026-06-13T00:00:00Z',
}

function jiraProvider(overrides: Partial<JiraProvider> = {}): JiraProvider {
  return {
    getMyself: vi.fn(),
    getProject: vi.fn(),
    listStatuses: vi.fn(),
    listTransitions: vi.fn(async () => FULL_TRANSITIONS),
    searchIssues: vi.fn(),
    getIssue: vi.fn(async () => SAMPLE_ISSUE),
    createIssue: vi.fn(),
    transitionIssue: vi.fn(),
    addComment: vi.fn(),
    ...overrides,
  }
}

describe('jira lifecycle', () => {
  it('resolves slot → configured name → available transition id and executes it', async () => {
    const path = writeConfig({ inProgress: 'In Progress' })
    const jira = jiraProvider()
    const io = captureIo()
    await run(
      ['lifecycle', 'RANDO-7', 'in-progress', '--config', path],
      mockAdapters(jira),
      io,
      gitWithCommits([]).git,
    )
    expect(jira.transitionIssue).toHaveBeenCalledWith({
      issueKey: 'RANDO-7',
      transitionId: '21',
    })
    expect(io.stdout.join('\n')).toContain('RANDO-7 → In Progress')
  })

  it('accepts a transition id in the lifecycle config', async () => {
    const path = writeConfig({ inReview: '31' })
    const jira = jiraProvider()
    await run(
      ['lifecycle', 'RANDO-7', 'in-review', '--config', path],
      mockAdapters(jira),
      captureIo(),
      gitWithCommits([]).git,
    )
    expect(jira.transitionIssue).toHaveBeenCalledWith({
      issueKey: 'RANDO-7',
      transitionId: '31',
    })
  })

  it('--message posts a comment alongside the transition', async () => {
    const path = writeConfig({ inReview: 'In Review' })
    const jira = jiraProvider()
    await run(
      ['lifecycle', 'RANDO-7', 'in-review', '-m', 'Deploy: https://x.dev', '--config', path],
      mockAdapters(jira),
      captureIo(),
      gitWithCommits([]).git,
    )
    expect(jira.addComment).toHaveBeenCalledWith({
      issueKey: 'RANDO-7',
      body: 'Deploy: https://x.dev',
    })
    expect(jira.transitionIssue).toHaveBeenCalled()
  })

  it('is idempotent: when the configured transition is not in the available list, no-op success', async () => {
    const path = writeConfig({ inProgress: 'In Progress' })
    // Issue already past In Progress — say, in In Review — so the only
    // available transitions don't include "In Progress" as a name.
    const jira = jiraProvider({
      listTransitions: vi.fn(async () => [{ id: '41', name: 'Done', to: STATUS_DONE }]),
      getIssue: vi.fn(async () => ({ ...SAMPLE_ISSUE, status: STATUS_IN_REVIEW })),
    })
    const io = captureIo()
    await run(
      ['lifecycle', 'RANDO-7', 'in-progress', '--config', path],
      mockAdapters(jira),
      io,
      gitWithCommits([]).git,
    )
    expect(jira.transitionIssue).not.toHaveBeenCalled()
    expect(io.stdout.join('\n')).toContain('already at In Review')
  })

  it('is idempotent: when the configured transition target equals the current status, no-op (self-loop guard)', async () => {
    // Default Jira workflows often expose every status as a transition
    // even from itself. Without the self-loop check we'd fire a "no-op"
    // transition that still pollutes the audit log.
    const path = writeConfig({ inProgress: 'In Progress' })
    const jira = jiraProvider({
      // The full transition list is still available — including In Progress.
      listTransitions: vi.fn(async () => FULL_TRANSITIONS),
      // But the issue is ALREADY at In Progress.
      getIssue: vi.fn(async () => ({ ...SAMPLE_ISSUE, status: STATUS_IN_PROGRESS })),
    })
    const io = captureIo()
    await run(
      ['lifecycle', 'RANDO-7', 'in-progress', '--config', path],
      mockAdapters(jira),
      io,
      gitWithCommits([]).git,
    )
    expect(jira.transitionIssue).not.toHaveBeenCalled()
    expect(io.stdout.join('\n')).toMatch(/already at In Progress.*no-op/)
  })

  it('--message still fires when the transition is a no-op', async () => {
    // Useful for staging deploy URL comments: comment lands even if
    // the ticket is already in In Review.
    const path = writeConfig({ inReview: 'In Review' })
    const jira = jiraProvider({
      listTransitions: vi.fn(async () => []),
      getIssue: vi.fn(async () => ({ ...SAMPLE_ISSUE, status: STATUS_IN_REVIEW })),
    })
    await run(
      ['lifecycle', 'RANDO-7', 'in-review', '-m', 'Deploy: https://x.dev', '--config', path],
      mockAdapters(jira),
      captureIo(),
      gitWithCommits([]).git,
    )
    expect(jira.addComment).toHaveBeenCalledWith({
      issueKey: 'RANDO-7',
      body: 'Deploy: https://x.dev',
    })
  })

  it('throws when the slot is unknown', async () => {
    const path = writeConfig({})
    await expect(
      run(
        ['lifecycle', 'RANDO-7', 'bogus', '--config', path],
        mockAdapters(jiraProvider()),
        captureIo(),
        gitWithCommits([]).git,
      ),
    ).rejects.toThrow(/Invalid lifecycle slot/)
  })

  it('throws when the slot has no configured transition', async () => {
    const path = writeConfig({}) // empty transitions map
    await expect(
      run(
        ['lifecycle', 'RANDO-7', 'in-progress', '--config', path],
        mockAdapters(jiraProvider()),
        captureIo(),
        gitWithCommits([]).git,
      ),
    ).rejects.toThrow(/jira\.transitions\.inProgress/)
  })

  it('accepts the slot with or without a hyphen (in-progress / inprogress / InProgress)', async () => {
    const path = writeConfig({ inProgress: 'In Progress' })
    const jira = jiraProvider()
    await run(
      ['lifecycle', 'RANDO-7', 'inProgress', '--config', path],
      mockAdapters(jira),
      captureIo(),
      gitWithCommits([]).git,
    )
    expect(jira.transitionIssue).toHaveBeenCalled()
  })
})
