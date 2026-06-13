import { describe, expect, it } from 'vitest'
import { JiraCloudProvider } from '../adapters/jira-cloud'
import { ProviderApiError } from '../domain/errors'
import { stubFetch } from './helpers'

const EXPECTED_AUTH = `Basic ${Buffer.from('me@example.com:tok-abc').toString('base64')}`

function adapter(stub: ReturnType<typeof stubFetch>) {
  return new JiraCloudProvider({
    baseUrl: 'https://acme.atlassian.net',
    email: 'me@example.com',
    apiToken: 'tok-abc',
    fetch: stub.fetch,
  })
}

describe('JiraCloudProvider', () => {
  it('getMyself sends Basic auth + normalizes the response', async () => {
    const stub = stubFetch([
      {
        body: { accountId: 'acct_1', displayName: 'Newton', emailAddress: 'n@example.com' },
      },
    ])
    const result = await adapter(stub).getMyself()
    expect(result).toEqual({
      accountId: 'acct_1',
      displayName: 'Newton',
      emailAddress: 'n@example.com',
    })
    expect(stub.calls[0]?.url).toBe('https://acme.atlassian.net/rest/api/3/myself')
    expect(stub.calls[0]?.headers).toMatchObject({ Authorization: EXPECTED_AUTH })
  })

  it('omits emailAddress when missing on the response', async () => {
    const stub = stubFetch([{ body: { accountId: 'acct_2', displayName: 'Anon' } }])
    const result = await adapter(stub).getMyself()
    expect(result).toEqual({ accountId: 'acct_2', displayName: 'Anon' })
  })

  it('getProject hits /rest/api/3/project/<key>', async () => {
    const stub = stubFetch([{ body: { id: '10001', key: 'RANDO', name: 'Rando' } }])
    const result = await adapter(stub).getProject('RANDO')
    expect(result).toEqual({ id: '10001', key: 'RANDO', name: 'Rando' })
    expect(stub.calls[0]?.url).toBe('https://acme.atlassian.net/rest/api/3/project/RANDO')
  })

  it('listStatuses dedupes by status id across issue types', async () => {
    const stub = stubFetch([
      {
        body: [
          {
            id: '10001',
            name: 'Task',
            statuses: [
              { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
              { id: '2', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            ],
          },
          {
            id: '10002',
            name: 'Bug',
            statuses: [
              // Same status id appearing under another issue type — dedupe.
              { id: '2', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              { id: '3', name: 'Done', statusCategory: { key: 'done' } },
            ],
          },
        ],
      },
    ])
    const result = await adapter(stub).listStatuses('RANDO')
    expect(result.map((s) => s.id)).toEqual(['1', '2', '3'])
    expect(result[1]?.category).toBe('indeterminate')
    expect(result[2]?.category).toBe('done')
  })

  it('maps unknown statusCategory to "unknown"', async () => {
    const stub = stubFetch([
      {
        body: [
          {
            id: '10003',
            name: 'X',
            statuses: [{ id: '9', name: 'Weird', statusCategory: { key: 'something-else' } }],
          },
        ],
      },
    ])
    const result = await adapter(stub).listStatuses('RANDO')
    expect(result[0]?.category).toBe('unknown')
  })

  it('listTransitions maps `to` into a JiraStatus', async () => {
    const stub = stubFetch([
      {
        body: {
          transitions: [
            {
              id: '11',
              name: 'Start progress',
              to: { id: '2', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            },
          ],
        },
      },
    ])
    const result = await adapter(stub).listTransitions('RANDO-1')
    expect(result[0]).toEqual({
      id: '11',
      name: 'Start progress',
      to: { id: '2', name: 'In Progress', category: 'indeterminate' },
    })
    expect(stub.calls[0]?.url).toBe(
      'https://acme.atlassian.net/rest/api/3/issue/RANDO-1/transitions',
    )
  })

  it('searchIssues builds JQL with project + assignee + openOnly + order by', async () => {
    const stub = stubFetch([
      {
        body: {
          issues: [
            {
              id: 'i_1',
              key: 'RANDO-7',
              fields: {
                summary: 'Add search',
                status: { id: '2', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
                assignee: { accountId: 'acct_1', displayName: 'Newton' },
                updated: '2026-06-13T00:00:00.000Z',
              },
            },
          ],
        },
      },
    ])
    const result = await adapter(stub).searchIssues({
      projectKey: 'RANDO',
      assignee: 'currentUser',
      openOnly: true,
      limit: 10,
    })
    expect(result[0]?.key).toBe('RANDO-7')
    const url = stub.calls[0]?.url ?? ''
    // The JQL we expect to come back, decoded.
    const params = new URL(url).searchParams
    expect(params.get('jql')).toBe(
      'project = "RANDO" AND assignee = currentUser() AND statusCategory != Done order by updated DESC',
    )
    expect(params.get('maxResults')).toBe('10')
    expect(params.get('fields')).toBe('summary,status,assignee,updated')
  })

  it('searchIssues uses a quoted assignee accountId when not currentUser', async () => {
    const stub = stubFetch([{ body: { issues: [] } }])
    await adapter(stub).searchIssues({ assignee: 'acct_42' })
    const url = stub.calls[0]?.url ?? ''
    const jql = new URL(url).searchParams.get('jql')
    expect(jql).toBe('assignee = "acct_42" order by updated DESC')
  })

  it('searchIssues handles assignee with embedded double-quote (escaped)', async () => {
    const stub = stubFetch([{ body: { issues: [] } }])
    await adapter(stub).searchIssues({ assignee: 'evil"name' })
    const jql = new URL(stub.calls[0]?.url ?? '').searchParams.get('jql')
    expect(jql).toBe('assignee = "evil\\"name" order by updated DESC')
  })

  it('getIssue with a null assignee returns assignee: null', async () => {
    const stub = stubFetch([
      {
        body: {
          id: 'i_1',
          key: 'RANDO-1',
          fields: {
            summary: 'X',
            status: { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
            assignee: null,
            updated: '2026-06-13T00:00:00.000Z',
          },
        },
      },
    ])
    const result = await adapter(stub).getIssue('RANDO-1')
    expect(result.assignee).toBeNull()
    expect(stub.calls[0]?.url).toContain('/issue/RANDO-1?')
  })

  it('createIssue wraps a plain-text description into ADF and defaults issuetype to Task', async () => {
    const stub = stubFetch([{ status: 201, body: { key: 'RANDO-42' } }])
    const result = await adapter(stub).createIssue({
      projectKey: 'RANDO',
      summary: 'Implement search',
      description: 'multi-line\nbody',
    })
    expect(result.key).toBe('RANDO-42')
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
      },
    })
  })

  it('createIssue emits labels when provided', async () => {
    const stub = stubFetch([{ status: 201, body: { key: 'RANDO-50' } }])
    await adapter(stub).createIssue({
      projectKey: 'RANDO',
      summary: 'Backfill',
      labels: ['backfill', 'historical'],
    })
    const body = stub.calls[0]?.body as { fields: { labels?: string[] } }
    expect(body.fields.labels).toEqual(['backfill', 'historical'])
  })

  it('createIssue omits labels when empty array', async () => {
    const stub = stubFetch([{ status: 201, body: { key: 'RANDO-51' } }])
    await adapter(stub).createIssue({ projectKey: 'RANDO', summary: 'X', labels: [] })
    const body = stub.calls[0]?.body as { fields: { labels?: string[] } }
    expect(body.fields.labels).toBeUndefined()
  })

  it('createIssue omits the description field when not provided', async () => {
    const stub = stubFetch([{ status: 201, body: { key: 'RANDO-43' } }])
    await adapter(stub).createIssue({ projectKey: 'RANDO', summary: 'no body' })
    const body = stub.calls[0]?.body as { fields: { description?: unknown } }
    expect(body.fields.description).toBeUndefined()
  })

  it('transitionIssue POSTs the transition id', async () => {
    // Real Jira returns 204 here; the helper can't synthesize a 204 with a
    // body, so use 200 with empty text — request() handles both.
    const stub = stubFetch([{ status: 200, text: '' }])
    await adapter(stub).transitionIssue({ issueKey: 'RANDO-1', transitionId: '11' })
    expect(stub.calls[0]?.method).toBe('POST')
    expect(stub.calls[0]?.url).toBe(
      'https://acme.atlassian.net/rest/api/3/issue/RANDO-1/transitions',
    )
    expect(stub.calls[0]?.body).toEqual({ transition: { id: '11' } })
  })

  it('addComment wraps the body in ADF', async () => {
    const stub = stubFetch([{ status: 201, body: { id: 'c1' } }])
    await adapter(stub).addComment({ issueKey: 'RANDO-1', body: 'Deployed to https://x.dev' })
    expect(stub.calls[0]?.body).toEqual({
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Deployed to https://x.dev' }],
          },
        ],
      },
    })
  })

  it('throws ProviderApiError on non-success with the response body', async () => {
    const stub = stubFetch([{ status: 401, text: 'unauthorized' }])
    await expect(adapter(stub).getMyself()).rejects.toBeInstanceOf(ProviderApiError)
  })

  it('strips trailing slashes from baseUrl', async () => {
    const stub = stubFetch([{ body: { accountId: 'a', displayName: 'b' } }])
    const provider = new JiraCloudProvider({
      baseUrl: 'https://acme.atlassian.net///',
      email: 'm@e.com',
      apiToken: 'tok',
      fetch: stub.fetch,
    })
    await provider.getMyself()
    expect(stub.calls[0]?.url).toBe('https://acme.atlassian.net/rest/api/3/myself')
  })
})
