import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'
import type { Adapters } from '../config'
import type { JiraProvider } from '../domain/jira'
import type { GitRunner } from '../git'
import { jiraCommand } from '../commands/jira'
import { captureIo } from './helpers'

function mockAdapters(jira: JiraProvider): Adapters {
  const never = (() => {
    throw new Error('not expected to be called')
  }) as never
  return { db: never, tunnel: never, dns: never, deploy: never, jira: () => jira }
}

const FIELD = '\x1f'
const RECORD = '\x1e'

function gitWithCommits(commits: Array<[string, string, string, string]>): GitRunner {
  const out =
    commits
      .map(([sha, date, subject, body]) => [sha, date, subject, body].join(FIELD))
      .join(RECORD) + RECORD
  return { run: () => out }
}

function writeConfig(opts: { jira?: boolean; repo?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jira-backfill-'))
  const path = join(dir, 'rando.config.json')
  writeFileSync(
    path,
    JSON.stringify({
      project: 'rando',
      repo: opts.repo ?? 'rando-id/rando',
      domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
      apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
      ...(opts.jira !== false ? { jira: { projectKey: 'RANDO', transitions: {} } } : {}),
    }),
  )
  return path
}

function jiraProvider(overrides: Partial<JiraProvider> = {}): JiraProvider {
  let nextKey = 1
  return {
    getMyself: vi.fn(),
    getProject: vi.fn(),
    listStatuses: vi.fn(),
    searchIssues: vi.fn(),
    getIssue: vi.fn(),
    createIssue: vi.fn(async () => ({ key: `RANDO-${nextKey++}` })),
    listTransitions: vi.fn(async () => [
      { id: '41', name: 'Done', to: { id: '3', name: 'Done', category: 'done' as const } },
    ]),
    transitionIssue: vi.fn(),
    addComment: vi.fn(),
    ...overrides,
  }
}

let cwdSpy: ReturnType<typeof vi.spyOn> | undefined

beforeEach(() => {
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/tmp')
})

afterEach(() => {
  cwdSpy?.mockRestore()
})

async function runBackfill(
  args: string[],
  adapters: Adapters,
  io: ReturnType<typeof captureIo>,
  git: GitRunner,
) {
  const program = new Command().exitOverride()
  program.addCommand(jiraCommand(adapters, io.io, { git }))
  await program.parseAsync(['node', 'rando', 'jira', ...args])
}

describe('jira backfill (dry-run default)', () => {
  it('lists every commit it would create without calling the API', async () => {
    const path = writeConfig()
    const git = gitWithCommits([
      ['a'.repeat(40), '2026-06-13T00:00:00Z', 'feat: search/sort', ''],
      ['b'.repeat(40), '2026-06-12T00:00:00Z', 'chore: docs', ''],
    ])
    const jira = jiraProvider()
    const io = captureIo()
    await runBackfill(['backfill', '--config', path], mockAdapters(jira), io, git)
    expect(jira.createIssue).not.toHaveBeenCalled()
    const out = io.stdout.join('\n')
    expect(out).toContain('Would create 2 tickets')
    expect(out).toContain('feat: search/sort')
    expect(out).toContain('chore: docs')
    expect(out).toContain('--apply')
  })

  it('returns a "no commits" hint when git returns nothing', async () => {
    const path = writeConfig()
    const io = captureIo()
    await runBackfill(['backfill', '--config', path], mockAdapters(jiraProvider()), io, {
      run: () => '',
    })
    expect(io.stdout.join('\n')).toContain('no commits to backfill')
  })

  it('throws when no project key is resolvable', async () => {
    const path = writeConfig({ jira: false })
    const io = captureIo()
    const git = gitWithCommits([['a'.repeat(40), '2026-06-13T00:00:00Z', 's', '']])
    await expect(
      runBackfill(['backfill', '--config', path], mockAdapters(jiraProvider()), io, git),
    ).rejects.toThrow(/No Jira project key/)
  })
})

describe('jira backfill --apply', () => {
  it('creates one ticket per commit with the backfill label and transitions each to Done', async () => {
    const path = writeConfig({ repo: 'rando-id/rando' })
    const git = gitWithCommits([
      ['a'.repeat(40), '2026-06-13T00:00:00Z', 'feat: search/sort', 'with a body'],
      ['b'.repeat(40), '2026-06-12T00:00:00Z', 'chore: docs', ''],
    ])
    const jira = jiraProvider()
    const io = captureIo()
    await runBackfill(['backfill', '--apply', '--config', path], mockAdapters(jira), io, git)

    expect(jira.createIssue).toHaveBeenCalledTimes(2)
    const firstCall = (jira.createIssue as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(firstCall).toMatchObject({
      projectKey: 'RANDO',
      summary: 'feat: search/sort',
      labels: ['backfill'],
    })
    // Description includes the SHA and the commit URL built from `repo`.
    expect(firstCall.description).toContain('aaaaaaa')
    expect(firstCall.description).toContain(
      'https://github.com/rando-id/rando/commit/' + 'a'.repeat(40),
    )
    expect(firstCall.description).toContain('with a body')

    expect(jira.transitionIssue).toHaveBeenCalledTimes(2)
    expect(jira.transitionIssue).toHaveBeenCalledWith({
      issueKey: 'RANDO-1',
      transitionId: '41',
    })
    expect(io.stdout.join('\n')).toContain('backfill complete — 2/2 tickets created')
  })

  it('uses a custom label when --label is passed', async () => {
    const path = writeConfig()
    const git = gitWithCommits([['a'.repeat(40), '2026-06-13T00:00:00Z', 's', '']])
    const jira = jiraProvider()
    await runBackfill(
      ['backfill', '--apply', '--label', 'historical', '--config', path],
      mockAdapters(jira),
      captureIo(),
      git,
    )
    const call = (jira.createIssue as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(call.labels).toEqual(['historical'])
  })

  it('warns when no Done transition is available but keeps going', async () => {
    const path = writeConfig()
    const git = gitWithCommits([['a'.repeat(40), '2026-06-13T00:00:00Z', 's', '']])
    const jira = jiraProvider({
      // No transition with category 'done'.
      listTransitions: vi.fn(async () => [
        {
          id: '21',
          name: 'In Progress',
          to: { id: '2', name: 'In Progress', category: 'indeterminate' as const },
        },
      ]),
    })
    const io = captureIo()
    await runBackfill(['backfill', '--apply', '--config', path], mockAdapters(jira), io, git)
    expect(jira.transitionIssue).not.toHaveBeenCalled()
    expect(io.stdout.join('\n')).toContain('no direct Done transition available')
    expect(io.stdout.join('\n')).toContain('1/1 ticket created')
  })

  it('continues after a single ticket failure and reports the count', async () => {
    const path = writeConfig()
    const git = gitWithCommits([
      ['a'.repeat(40), '2026-06-13T00:00:00Z', 'first', ''],
      ['b'.repeat(40), '2026-06-12T00:00:00Z', 'second', ''],
    ])
    let n = 0
    const jira = jiraProvider({
      createIssue: vi.fn(async () => {
        if (n++ === 0) throw new Error('API 500')
        return { key: 'RANDO-2' }
      }),
    })
    const io = captureIo()
    await runBackfill(['backfill', '--apply', '--config', path], mockAdapters(jira), io, git)
    const out = io.stdout.join('\n')
    expect(out).toContain('API 500')
    expect(out).toContain('1/2 tickets created')
    expect(out).toContain('(1 failure)')
  })

  it('omits the commit URL when repo is missing from config', async () => {
    // No `repo` field at all → config schema requires it, so this hits
    // the loadRepo catch path. Use a malformed config.
    const dir = mkdtempSync(join(tmpdir(), 'jira-backfill-norepo-'))
    const path = join(dir, 'rando.config.json')
    writeFileSync(path, JSON.stringify({ jira: { projectKey: 'RANDO', transitions: {} } }))
    const git = gitWithCommits([['a'.repeat(40), '2026-06-13T00:00:00Z', 's', '']])
    const jira = jiraProvider()
    await runBackfill(
      ['backfill', '--apply', '--project', 'RANDO', '--config', path],
      mockAdapters(jira),
      captureIo(),
      git,
    )
    const call = (jira.createIssue as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(call.description).not.toContain('github.com')
  })
})
