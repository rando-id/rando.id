// Tests for the Jira Cloud IssueTrackerProvider adapter. Covers the
// HTTP shape (auth, JQL builder, ADF wrapping), the lifecycle
// state-machine logic (self-loop guard, transition-not-available
// idempotency), and the doctor report.

import { describe, expect, it } from 'vitest'
import { JiraCloudProvider } from '../adapters/jira-cloud'
import { ProviderApiError } from '../domain/errors'
import { stubFetch } from './helpers'

const EXPECTED_AUTH = `Basic ${Buffer.from('me@example.com:tok-abc').toString('base64')}`

function adapter(
  stub: ReturnType<typeof stubFetch>,
  overrides: Partial<{ projectKey: string; transitions: Record<string, string> }> = {},
) {
  return new JiraCloudProvider({
    baseUrl: 'https://acme.atlassian.net',
    email: 'me@example.com',
    apiToken: 'tok-abc',
    projectKey: overrides.projectKey ?? 'RANDO',
    transitions: overrides.transitions ?? {
      inProgress: 'In Progress',
      inReview: 'In Review',
      done: 'Done',
    },
    fetch: stub.fetch,
  })
}

const STATUS_TO_DO = { id: '1', name: 'To Do', statusCategory: { key: 'new' } }
const STATUS_IN_PROGRESS = {
  id: '2',
  name: 'In Progress',
  statusCategory: { key: 'indeterminate' },
}
const STATUS_DONE = { id: '3', name: 'Done', statusCategory: { key: 'done' } }

const TRANSITIONS = [
  { id: '11', name: 'To Do', to: STATUS_TO_DO },
  { id: '21', name: 'In Progress', to: STATUS_IN_PROGRESS },
  { id: '41', name: 'Done', to: STATUS_DONE },
]

const ISSUE_RAW = {
  id: 'i_1',
  key: 'RANDO-7',
  fields: {
    summary: 'Add search',
    status: STATUS_TO_DO,
    assignee: { accountId: 'acct_1', displayName: 'Newton' },
    updated: '2026-06-13T00:00:00.000Z',
  },
}

describe('JiraCloudProvider', () => {
  it('getMyself sends Basic auth + normalizes to TrackerUser', async () => {
    const stub = stubFetch([
      {
        body: { accountId: 'acct_1', displayName: 'Newton', emailAddress: 'n@example.com' },
      },
    ])
    const result = await adapter(stub).getMyself()
    expect(result).toEqual({ id: 'acct_1', displayName: 'Newton', emailAddress: 'n@example.com' })
    expect(stub.calls[0]?.url).toBe('https://acme.atlassian.net/rest/api/3/myself')
    expect(stub.calls[0]?.headers).toMatchObject({ Authorization: EXPECTED_AUTH })
  })

  it('searchIssues builds JQL with the bound project + filter', async () => {
    const stub = stubFetch([{ body: { issues: [ISSUE_RAW] } }])
    const result = await adapter(stub).searchIssues({
      assignee: 'currentUser',
      openOnly: true,
      limit: 10,
    })
    expect(result[0]).toMatchObject({
      key: 'RANDO-7',
      status: 'To Do',
      statusCategory: 'open',
      assignee: { id: 'acct_1', displayName: 'Newton' },
      url: 'https://acme.atlassian.net/browse/RANDO-7',
    })
    const url = stub.calls[0]?.url ?? ''
    expect(new URL(url).searchParams.get('jql')).toBe(
      'project = "RANDO" AND assignee = currentUser() AND statusCategory != Done order by updated DESC',
    )
  })

  it('createIssue wraps description into ADF and emits labels when present', async () => {
    const stub = stubFetch([{ status: 201, body: { key: 'RANDO-42' } }])
    await adapter(stub).createIssue({
      summary: 'Implement search',
      description: 'multi-line\nbody',
      labels: ['backfill'],
    })
    expect(stub.calls[0]?.body).toEqual({
      fields: {
        project: { key: 'RANDO' },
        summary: 'Implement search',
        issuetype: { name: 'Task' },
        description: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'multi-line\nbody' }] }],
        },
        labels: ['backfill'],
      },
    })
  })

  it('createIssue omits description + labels when not provided', async () => {
    const stub = stubFetch([{ status: 201, body: { key: 'RANDO-43' } }])
    await adapter(stub).createIssue({ summary: 'no body' })
    const body = stub.calls[0]?.body as { fields: { description?: unknown; labels?: unknown } }
    expect(body.fields.description).toBeUndefined()
    expect(body.fields.labels).toBeUndefined()
  })

  it('applyLifecycle: real transition To Do → In Progress', async () => {
    const stub = stubFetch([
      { body: { transitions: TRANSITIONS } }, // listTransitions
      { body: ISSUE_RAW }, // getIssue
      { status: 200, text: '' }, // POST transition
    ])
    const result = await adapter(stub).applyLifecycle({ key: 'RANDO-7', slot: 'inProgress' })
    expect(result).toEqual({
      transitioned: true,
      status: 'In Progress',
      via: 'via "In Progress"',
    })
    // POST request was issued.
    expect(stub.calls[2]?.method).toBe('POST')
    expect(stub.calls[2]?.body).toEqual({ transition: { id: '21' } })
  })

  it('applyLifecycle is idempotent: self-loop (issue already at target status)', async () => {
    // Issue is already In Progress; the configured "In Progress"
    // transition is still in the available list (default workflow
    // self-loop), but applyLifecycle should detect and no-op.
    const stub = stubFetch([
      { body: { transitions: TRANSITIONS } },
      { body: { ...ISSUE_RAW, fields: { ...ISSUE_RAW.fields, status: STATUS_IN_PROGRESS } } },
    ])
    const result = await adapter(stub).applyLifecycle({ key: 'RANDO-7', slot: 'inProgress' })
    expect(result.transitioned).toBe(false)
    expect(result.status).toBe('In Progress')
    // Only 2 calls — no POST transition.
    expect(stub.calls).toHaveLength(2)
  })

  it('applyLifecycle is idempotent: transition not available (already past)', async () => {
    const stub = stubFetch([
      { body: { transitions: [{ id: '41', name: 'Done', to: STATUS_DONE }] } },
      { body: { ...ISSUE_RAW, fields: { ...ISSUE_RAW.fields, status: STATUS_DONE } } },
    ])
    const result = await adapter(stub).applyLifecycle({ key: 'RANDO-7', slot: 'inProgress' })
    expect(result.transitioned).toBe(false)
    expect(result.via).toContain('not available')
  })

  it('applyLifecycle throws when the slot is unmapped in config', async () => {
    const stub = stubFetch([])
    const a = adapter(stub, { transitions: {} })
    await expect(a.applyLifecycle({ key: 'RANDO-7', slot: 'inProgress' })).rejects.toThrow(
      /tracker\.jira\.transitions\.inProgress/,
    )
  })

  it('addComment wraps the body in ADF', async () => {
    const stub = stubFetch([{ status: 201, body: { id: 'c1' } }])
    await adapter(stub).addComment({ key: 'RANDO-1', body: 'Deployed to https://x.dev' })
    expect(stub.calls[0]?.body).toEqual({
      body: {
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Deployed to https://x.dev' }] },
        ],
      },
    })
  })

  it('doctor returns a structured report with project label + lifecycle resolution', async () => {
    const stub = stubFetch([
      { body: { accountId: 'a', displayName: 'Newton', emailAddress: 'n@x.com' } }, // myself
      { body: { id: '10001', key: 'RANDO', name: 'Rando' } }, // project
      {
        body: [
          {
            id: '10001',
            name: 'Task',
            statuses: [STATUS_TO_DO, STATUS_IN_PROGRESS, STATUS_DONE],
          },
        ],
      }, // statuses
      { body: { issues: [ISSUE_RAW] } }, // search (sample)
      { body: { transitions: TRANSITIONS } }, // transitions for the sample
    ])
    const report = await adapter(stub).doctor()
    expect(report.authedAs).toBe('Newton (n@x.com)')
    expect(report.projectLabel).toBe('Project: RANDO (Rando)')
    expect(report.statuses.map((s) => s.name)).toEqual(['To Do', 'In Progress', 'Done'])
    // Lifecycle slots resolved against the transition list.
    const slots = Object.fromEntries(report.lifecycle.map((l) => [l.slot, l]))
    expect(slots.inProgress?.resolved).toBe(true)
    expect(slots.inProgress?.note).toContain('In Progress')
    expect(slots.done?.resolved).toBe(true)
    expect(slots.inReview?.resolved).toBe(false) // not in our TRANSITIONS list
  })

  it('throws ProviderApiError on non-success', async () => {
    const stub = stubFetch([{ status: 401, text: 'unauthorized' }])
    await expect(adapter(stub).getMyself()).rejects.toBeInstanceOf(ProviderApiError)
  })

  it('strips trailing slashes from baseUrl', async () => {
    const stub = stubFetch([{ body: { accountId: 'a', displayName: 'b' } }])
    const provider = new JiraCloudProvider({
      baseUrl: 'https://acme.atlassian.net///',
      email: 'm@e.com',
      apiToken: 'tok',
      projectKey: 'RANDO',
      transitions: {},
      fetch: stub.fetch,
    })
    await provider.getMyself()
    expect(stub.calls[0]?.url).toBe('https://acme.atlassian.net/rest/api/3/myself')
  })
})
