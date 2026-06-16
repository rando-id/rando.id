import { describe, expect, it, vi } from 'vitest'
import {
  getCachedJiraKey,
  getCurrentBranch,
  JIRA_SKIP_SENTINEL,
  setCachedJiraKey,
  unsetCachedJiraKey,
  type GitRunner,
} from '../git'

function stub(responses: Array<string | null>): {
  git: GitRunner
  calls: string[][]
} {
  const calls: string[][] = []
  let i = 0
  return {
    git: {
      run(args) {
        calls.push(args)
        return responses[i++] ?? null
      },
    },
    calls,
  }
}

describe('getCurrentBranch', () => {
  it('returns the branch name from rev-parse', () => {
    const s = stub(['feat-search-sort'])
    expect(getCurrentBranch(s.git)).toBe('feat-search-sort')
    expect(s.calls[0]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD'])
  })

  it('returns null on detached HEAD (git prints "HEAD")', () => {
    const s = stub(['HEAD'])
    expect(getCurrentBranch(s.git)).toBeNull()
  })

  it('returns null when git itself fails (not a repo)', () => {
    expect(getCurrentBranch(stub([null]).git)).toBeNull()
  })
})

describe('cached jira key', () => {
  it('reads via git config branch.<name>.jira-key', () => {
    const s = stub(['RANDO-42'])
    expect(getCachedJiraKey('feat-x', s.git)).toBe('RANDO-42')
    expect(s.calls[0]).toEqual(['config', 'branch.feat-x.jira-key'])
  })

  it('returns null when no key is cached', () => {
    expect(getCachedJiraKey('feat-x', stub([null]).git)).toBeNull()
  })

  it('writes with --replace-all so a second call overwrites', () => {
    const s = stub([''])
    setCachedJiraKey('feat-x', 'RANDO-7', s.git)
    expect(s.calls[0]).toEqual(['config', '--replace-all', 'branch.feat-x.jira-key', 'RANDO-7'])
  })

  it('unset removes the config entry', () => {
    const s = stub([''])
    unsetCachedJiraKey('feat-x', s.git)
    expect(s.calls[0]).toEqual(['config', '--unset', 'branch.feat-x.jira-key'])
  })

  it('exports the skip sentinel literal', () => {
    expect(JIRA_SKIP_SENTINEL).toBe('skip')
  })
})

describe('listCommits', () => {
  // The format is: <sha>\x1f<date>\x1f<subject>\x1f<body>\x1e
  const FIELD = '\x1f'
  const RECORD = '\x1e'

  function commitRecord(sha: string, date: string, subject: string, body: string): string {
    return [sha, date, subject, body].join(FIELD) + RECORD
  }

  it('parses sha + date + subject + body, newest first', async () => {
    const { listCommits } = await import('../git')
    const raw = [
      commitRecord('a'.repeat(40), '2026-06-13T10:00:00Z', 'feat: search/sort', 'body line'),
      commitRecord('b'.repeat(40), '2026-06-12T10:00:00Z', 'chore: docs', ''),
    ].join('')
    const result = listCommits({}, { run: () => raw })
    expect(result).toHaveLength(2)
    expect(result[0]?.sha).toBe('a'.repeat(40))
    expect(result[0]?.subject).toBe('feat: search/sort')
    expect(result[0]?.body).toBe('body line')
    expect(result[1]?.body).toBe('')
  })

  it('returns empty when git returns null (bad ref, not a repo)', async () => {
    const { listCommits } = await import('../git')
    expect(listCommits({}, { run: () => null })).toEqual([])
  })

  it('passes --since via the SHA..HEAD revrange', async () => {
    const { listCommits } = await import('../git')
    const calls: string[][] = []
    listCommits({ since: 'abc123' }, { run: (a) => (calls.push(a), '') })
    expect(calls[0]).toContain('abc123..HEAD')
  })

  it('passes --limit via -n', async () => {
    const { listCommits } = await import('../git')
    const calls: string[][] = []
    listCommits({ limit: 5 }, { run: (a) => (calls.push(a), '') })
    expect(calls[0]).toEqual(expect.arrayContaining(['-n', '5']))
  })

  it('tolerates trailing whitespace and empty records', async () => {
    const { listCommits } = await import('../git')
    const raw =
      commitRecord('a'.repeat(40), '2026-06-13T00:00:00Z', 's', '') + RECORD + '   ' + RECORD
    const result = listCommits({}, { run: () => raw })
    expect(result).toHaveLength(1)
  })
})

describe('parseJiraRefs', () => {
  it('pulls a single key out of a Refs: footer', async () => {
    const { parseJiraRefs } = await import('../git')
    expect(parseJiraRefs('feat: do thing\n\nRefs: RANDO-42')).toEqual(['RANDO-42'])
  })

  it('returns [] when no Refs: footer is present', async () => {
    const { parseJiraRefs } = await import('../git')
    expect(parseJiraRefs('chore: bump deps\n\nUnrelated body.')).toEqual([])
  })

  it('handles multi-key Refs (comma or space separated)', async () => {
    const { parseJiraRefs } = await import('../git')
    expect(parseJiraRefs('msg\n\nRefs: RANDO-1, RANDO-2 RANDO-3')).toEqual([
      'RANDO-1',
      'RANDO-2',
      'RANDO-3',
    ])
  })

  it('is case-insensitive on the "Refs:" label', async () => {
    const { parseJiraRefs } = await import('../git')
    expect(parseJiraRefs('msg\n\nrefs: RANDO-7')).toEqual(['RANDO-7'])
  })

  it('rejects malformed keys (lowercase, no number, etc.)', async () => {
    const { parseJiraRefs } = await import('../git')
    expect(parseJiraRefs('msg\n\nRefs: rando-1, FOO, BAR-, BAR-x')).toEqual([])
  })

  it('tolerates indentation on the Refs line', async () => {
    const { parseJiraRefs } = await import('../git')
    expect(parseJiraRefs('msg\n\n  Refs: RANDO-9')).toEqual(['RANDO-9'])
  })

  it('recognizes Fixes/Closes/Resolves keywords (GitHub auto-close triggers)', async () => {
    const { parseJiraRefs } = await import('../git')
    expect(parseJiraRefs('msg\n\nFixes: #5')).toEqual(['#5'])
    expect(parseJiraRefs('msg\n\nCloses: #6')).toEqual(['#6'])
    expect(parseJiraRefs('msg\n\nResolves: #7')).toEqual(['#7'])
    expect(parseJiraRefs('msg\n\nfixes: #8')).toEqual(['#8']) // case-insensitive
  })

  it('parses GitHub #N keys alongside Jira PROJ-N keys', async () => {
    const { parseJiraRefs } = await import('../git')
    expect(parseJiraRefs('msg\n\nFixes: #5, RANDO-2, #6')).toEqual(['#5', 'RANDO-2', '#6'])
  })

  it('rejects malformed GitHub-style refs (#x, #, owner/repo#N for now)', async () => {
    const { parseJiraRefs } = await import('../git')
    expect(parseJiraRefs('msg\n\nFixes: #x, #, #-1')).toEqual([])
  })
})

describe('lintCommitMessage', () => {
  it('passes when a Fixes: footer is present', async () => {
    const { lintCommitMessage } = await import('../git')
    expect(lintCommitMessage('feat: ship it\n\nFixes: #42')).toEqual({ ok: true })
  })

  it('passes for any of Fixes/Closes/Resolves/Refs', async () => {
    const { lintCommitMessage } = await import('../git')
    for (const kw of ['Fixes', 'Closes', 'Resolves', 'Refs']) {
      expect(lintCommitMessage(`feat: x\n\n${kw}: #1`).ok).toBe(true)
    }
  })

  it('passes for GitHub squash-merge subject ending in (#N)', async () => {
    const { lintCommitMessage } = await import('../git')
    expect(lintCommitMessage('chore: bump deps (#123)').ok).toBe(true)
    expect(lintCommitMessage('feat(api): foo bar (#1)\n\nbody text').ok).toBe(true)
  })

  it('passes for merge-commit auto-messages', async () => {
    const { lintCommitMessage } = await import('../git')
    expect(lintCommitMessage("Merge branch 'main' into feature").ok).toBe(true)
    expect(lintCommitMessage('Merge pull request #42 from owner/branch').ok).toBe(true)
    expect(lintCommitMessage("Merge remote-tracking branch 'origin/main'").ok).toBe(true)
  })

  it('passes for revert commits (original ref carried forward)', async () => {
    const { lintCommitMessage } = await import('../git')
    expect(lintCommitMessage('Revert "feat: bad idea"').ok).toBe(true)
  })

  it('rejects a bare commit with no ref', async () => {
    const { lintCommitMessage } = await import('../git')
    const result = lintCommitMessage('fix: typo')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/no issue reference/)
  })

  it('rejects an empty message', async () => {
    const { lintCommitMessage } = await import('../git')
    expect(lintCommitMessage('')).toEqual({ ok: false, reason: 'commit message is empty' })
    expect(lintCommitMessage('   \n\n  ')).toEqual({
      ok: false,
      reason: 'commit message is empty',
    })
  })

  it('strips `# ...` git comment lines before checking', async () => {
    const { lintCommitMessage } = await import('../git')
    // A message that's all comments is empty.
    expect(lintCommitMessage('# Please enter a commit message\n# Lines starting with #').ok).toBe(
      false,
    )
    // Real subject + a footer that's hidden by a leading `#` shouldn't count as a footer.
    expect(lintCommitMessage('fix: typo\n# Fixes: #42').ok).toBe(false)
  })

  it('rejects #N appearing only in the body (must be in a footer or squash-merge subject)', async () => {
    const { lintCommitMessage } = await import('../git')
    expect(lintCommitMessage('fix: x\n\nthis fixes #42 maybe').ok).toBe(false)
  })
})

describe('defaultGitRunner', () => {
  it('swallows exec errors and returns null', async () => {
    // Run an obviously-bogus command via the real runner to exercise the
    // catch branch. We do this via dynamic import to avoid leaking the
    // mock global to other tests.
    const { defaultGitRunner } = await import('../git')
    expect(defaultGitRunner.run(['bogus-subcommand-that-does-not-exist'])).toBeNull()
  })

  it('uses execFileSync so it never invokes a shell (safe with branch names containing $)', async () => {
    // Indirect: call rev-parse for a clearly-impossible branch name and
    // confirm we get null instead of throwing.
    const { defaultGitRunner } = await import('../git')
    expect(defaultGitRunner.run(['show-ref', '$(rm -rf /)'])).toBeNull()
  })

  // Silence unused-import warning under strict TS in test runs.
  vi.fn()
})
