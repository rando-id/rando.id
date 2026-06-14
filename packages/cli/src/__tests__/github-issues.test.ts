// Tests for the GitHub Issues adapter. Covers key parsing, the
// state+label lifecycle mapping (including the no-op idempotency
// path), and the doctor report.

import { describe, expect, it } from 'vitest'
import { GitHubIssuesProvider } from '../adapters/github-issues'
import { ProviderApiError } from '../domain/errors'
import { stubFetch } from './helpers'

const REPO = 'rando-id/rando'

function adapter(
  stub: ReturnType<typeof stubFetch>,
  labels = { inProgress: 'status:in-progress', inReview: 'status:in-review' },
) {
  return new GitHubIssuesProvider({
    token: 'gh_tok_abc',
    repo: REPO,
    labels,
    fetch: stub.fetch,
    baseUrl: 'https://api.github.test',
  })
}

const ISSUE_OPEN_RAW = {
  id: 1001,
  number: 7,
  title: 'Add search',
  state: 'open' as const,
  labels: [] as Array<{ name: string }>,
  assignee: null,
  updated_at: '2026-06-13T00:00:00Z',
  html_url: 'https://github.com/rando-id/rando/issues/7',
}

describe('GitHubIssuesProvider', () => {
  it('constructor rejects an invalid "owner/name" repo string', () => {
    expect(
      () =>
        new GitHubIssuesProvider({
          token: 't',
          repo: 'not-a-slash',
          labels: { inProgress: 'a', inReview: 'b' },
        }),
    ).toThrow(/Invalid GitHub repo/)
  })

  it('getMyself sends Bearer + the v3 API-Version header', async () => {
    const stub = stubFetch([{ body: { login: 'newton', name: 'Newton', email: 'n@x.com' } }])
    const result = await adapter(stub).getMyself()
    expect(result).toEqual({ id: 'newton', displayName: 'Newton', emailAddress: 'n@x.com' })
    expect(stub.calls[0]?.headers).toMatchObject({
      Authorization: 'Bearer gh_tok_abc',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    })
  })

  it('searchIssues filters out PRs (which the issues endpoint also returns)', async () => {
    const stub = stubFetch([
      {
        body: [
          ISSUE_OPEN_RAW,
          // PR: has pull_request field — should be excluded.
          { ...ISSUE_OPEN_RAW, id: 9, number: 9, pull_request: { url: 'x' } },
        ],
      },
    ])
    const result = await adapter(stub).searchIssues({})
    expect(result).toHaveLength(1)
    expect(result[0]?.key).toBe('#7')
  })

  it('searchIssues with --mine fetches the username first, then filters', async () => {
    const stub = stubFetch([
      { body: { login: 'newton', name: 'Newton' } }, // getMyself
      { body: [ISSUE_OPEN_RAW] }, // issues
    ])
    await adapter(stub).searchIssues({ assignee: 'currentUser' })
    const url = new URL(stub.calls[1]?.url ?? '')
    expect(url.searchParams.get('assignee')).toBe('newton')
  })

  it('mapIssue surfaces a status:in-progress label as the in-progress category', async () => {
    const stub = stubFetch([
      {
        body: [
          {
            ...ISSUE_OPEN_RAW,
            labels: [{ name: 'status:in-progress' }, { name: 'bug' }],
          },
        ],
      },
    ])
    const result = await adapter(stub).searchIssues({})
    expect(result[0]?.statusCategory).toBe('in-progress')
    expect(result[0]?.status).toContain('status:in-progress')
  })

  it('mapIssue maps closed → done', async () => {
    const stub = stubFetch([{ body: { ...ISSUE_OPEN_RAW, state: 'closed' } }])
    const result = await adapter(stub).getIssue('#7')
    expect(result.statusCategory).toBe('done')
    expect(result.status).toBe('closed')
  })

  it('parseIssueNumber accepts "#42", "42", and "owner/repo#42"', async () => {
    const stub = stubFetch([
      { body: ISSUE_OPEN_RAW },
      { body: ISSUE_OPEN_RAW },
      { body: ISSUE_OPEN_RAW },
    ])
    await adapter(stub).getIssue('#7')
    await adapter(stub).getIssue('7')
    await adapter(stub).getIssue('rando-id/rando#7')
    expect(stub.calls.every((c) => c.url.endsWith('/issues/7'))).toBe(true)
  })

  it('parseIssueNumber rejects cross-repo references the adapter is not bound to', async () => {
    const stub = stubFetch([])
    await expect(adapter(stub).getIssue('other/repo#7')).rejects.toThrow(/bound to/)
  })

  it('createIssue posts title + body + labels', async () => {
    const stub = stubFetch([{ status: 201, body: { ...ISSUE_OPEN_RAW, number: 42 } }])
    const result = await adapter(stub).createIssue({
      summary: 'feat: new thing',
      description: 'context',
      labels: ['backfill'],
    })
    expect(result.key).toBe('#42')
    expect(stub.calls[0]?.body).toEqual({
      title: 'feat: new thing',
      body: 'context',
      labels: ['backfill'],
    })
  })

  it('applyLifecycle inProgress: closed → open, removes other status labels, adds inProgress label', async () => {
    const stub = stubFetch([
      // initial getIssue
      {
        body: {
          ...ISSUE_OPEN_RAW,
          state: 'closed',
          labels: [{ name: 'status:in-review' }, { name: 'bug' }],
        },
      },
      // PATCH reopen
      { body: { ...ISSUE_OPEN_RAW, state: 'open' } },
      // DELETE old status label
      { status: 200, text: '' },
      // POST labels
      { body: [] },
    ])
    const result = await adapter(stub).applyLifecycle({ key: '#7', slot: 'inProgress' })
    expect(result.transitioned).toBe(true)
    // Reopen PATCH
    expect(stub.calls[1]?.method).toBe('PATCH')
    expect(stub.calls[1]?.body).toEqual({ state: 'open' })
    // DELETE the stale status:in-review label
    expect(stub.calls[2]?.method).toBe('DELETE')
    expect(stub.calls[2]?.url).toContain('/labels/status%3Ain-review')
    // POST add the new label
    expect(stub.calls[3]?.method).toBe('POST')
    expect(stub.calls[3]?.body).toEqual({ labels: ['status:in-progress'] })
  })

  it('applyLifecycle inProgress is idempotent: already open with the target label, no writes', async () => {
    const stub = stubFetch([
      {
        body: {
          ...ISSUE_OPEN_RAW,
          labels: [{ name: 'status:in-progress' }],
        },
      },
    ])
    const result = await adapter(stub).applyLifecycle({ key: '#7', slot: 'inProgress' })
    expect(result.transitioned).toBe(false)
    expect(stub.calls).toHaveLength(1) // just the read
  })

  it('applyLifecycle done: open issue → closed with state_reason=completed, strips status labels', async () => {
    const stub = stubFetch([
      {
        body: { ...ISSUE_OPEN_RAW, labels: [{ name: 'status:in-progress' }, { name: 'bug' }] },
      },
      { status: 200, text: '' }, // DELETE status:in-progress
      { body: { ...ISSUE_OPEN_RAW, state: 'closed' } }, // PATCH close
    ])
    const result = await adapter(stub).applyLifecycle({ key: '#7', slot: 'done' })
    expect(result.transitioned).toBe(true)
    expect(result.status).toBe('closed')
    expect(stub.calls[1]?.method).toBe('DELETE')
    expect(stub.calls[1]?.url).toContain('/labels/status%3Ain-progress')
    expect(stub.calls[2]?.method).toBe('PATCH')
    expect(stub.calls[2]?.body).toEqual({ state: 'closed', state_reason: 'completed' })
  })

  it('applyLifecycle done is idempotent: already closed, no writes', async () => {
    const stub = stubFetch([{ body: { ...ISSUE_OPEN_RAW, state: 'closed' } }])
    const result = await adapter(stub).applyLifecycle({ key: '#7', slot: 'done' })
    expect(result.transitioned).toBe(false)
    expect(stub.calls).toHaveLength(1)
  })

  it('addComment posts to /issues/<n>/comments', async () => {
    const stub = stubFetch([{ status: 201, body: { id: 1 } }])
    await adapter(stub).addComment({ key: '#7', body: 'Deployed' })
    expect(stub.calls[0]?.method).toBe('POST')
    expect(stub.calls[0]?.url).toContain('/issues/7/comments')
    expect(stub.calls[0]?.body).toEqual({ body: 'Deployed' })
  })

  it('doctor flags a missing status label without erroring', async () => {
    const stub = stubFetch([
      { body: { login: 'newton', name: 'Newton', email: 'n@x.com' } },
      { body: { full_name: 'rando-id/rando' } },
      { body: [{ name: 'status:in-progress' }, { name: 'bug' }] }, // in-review missing
    ])
    const report = await adapter(stub).doctor()
    expect(report.authedAs).toContain('Newton')
    expect(report.projectLabel).toBe('Repo: rando-id/rando')
    const slots = Object.fromEntries(report.lifecycle.map((l) => [l.slot, l]))
    expect(slots.inProgress?.resolved).toBe(true)
    expect(slots.inReview?.resolved).toBe(false)
    expect(slots.done?.resolved).toBe(true)
  })

  it('throws ProviderApiError on non-success', async () => {
    const stub = stubFetch([{ status: 401, text: 'bad creds' }])
    await expect(adapter(stub).getMyself()).rejects.toBeInstanceOf(ProviderApiError)
  })
})
