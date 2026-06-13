// Jira Cloud (https://<your>.atlassian.net) implementation of JiraProvider.
// API reference: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
//
// Auth: HTTP Basic with `<email>:<api-token>` base64-encoded. The API
// token is generated at https://id.atlassian.com/manage-profile/security/api-tokens
// and is per-user, not per-project.
//
// Note on description / comment bodies: v3 endpoints take Atlassian
// Document Format (ADF) — a structured JSON document. We wrap plain
// strings into a minimal one-paragraph ADF doc so callers don't have
// to know about it.

import { ProviderApiError } from '../domain/errors'
import type {
  JiraIssue,
  JiraProject,
  JiraProvider,
  JiraSearchFilter,
  JiraStatus,
  JiraTransition,
  JiraUser,
} from '../domain/jira'

export interface JiraCloudProviderOptions {
  /** Site URL: https://<workspace>.atlassian.net (no trailing slash). */
  baseUrl: string
  /** Atlassian account email. */
  email: string
  /** API token from https://id.atlassian.com/manage-profile/security/api-tokens. */
  apiToken: string
  /** Override for tests. Defaults to global fetch. */
  fetch?: typeof fetch
}

export class JiraCloudProvider implements JiraProvider {
  private readonly fetch: typeof fetch
  private readonly baseUrl: string
  private readonly authHeader: string

  constructor(opts: JiraCloudProviderOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.authHeader = `Basic ${Buffer.from(`${opts.email}:${opts.apiToken}`).toString('base64')}`
  }

  async getMyself(): Promise<JiraUser> {
    const raw = await this.request<RawUser>('GET', '/rest/api/3/myself')
    return mapUser(raw)
  }

  async getProject(key: string): Promise<JiraProject> {
    const raw = await this.request<RawProject>(
      'GET',
      `/rest/api/3/project/${encodeURIComponent(key)}`,
    )
    return { key: raw.key, id: raw.id, name: raw.name }
  }

  async listStatuses(projectKey: string): Promise<JiraStatus[]> {
    // /project/{key}/statuses returns one entry per issue type with its
    // workflow's statuses. Flatten + dedupe by status id.
    const raw = await this.request<RawIssueTypeStatuses[]>(
      'GET',
      `/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`,
    )
    const byId = new Map<string, JiraStatus>()
    for (const issueType of raw) {
      for (const status of issueType.statuses) {
        if (!byId.has(status.id)) byId.set(status.id, mapStatus(status))
      }
    }
    return [...byId.values()]
  }

  async listTransitions(issueKey: string): Promise<JiraTransition[]> {
    const raw = await this.request<{ transitions: RawTransition[] }>(
      'GET',
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    )
    return raw.transitions.map((t) => ({
      id: t.id,
      name: t.name,
      to: mapStatus(t.to),
    }))
  }

  async searchIssues(filter: JiraSearchFilter): Promise<JiraIssue[]> {
    const jql = buildJql(filter)
    const params = new URLSearchParams({
      jql,
      fields: 'summary,status,assignee,updated',
      maxResults: String(filter.limit ?? 50),
    })
    const raw = await this.request<{ issues: RawIssue[] }>(
      'GET',
      `/rest/api/3/search/jql?${params.toString()}`,
    )
    return raw.issues.map(mapIssue)
  }

  async getIssue(key: string): Promise<JiraIssue> {
    const params = new URLSearchParams({ fields: 'summary,status,assignee,updated' })
    const raw = await this.request<RawIssue>(
      'GET',
      `/rest/api/3/issue/${encodeURIComponent(key)}?${params.toString()}`,
    )
    return mapIssue(raw)
  }

  async createIssue(input: {
    projectKey: string
    summary: string
    description?: string
    issueType?: string
    labels?: string[]
  }): Promise<{ key: string }> {
    const body: Record<string, unknown> = {
      fields: {
        project: { key: input.projectKey },
        summary: input.summary,
        issuetype: { name: input.issueType ?? 'Task' },
        ...(input.description ? { description: toAdf(input.description) } : {}),
        ...(input.labels?.length ? { labels: input.labels } : {}),
      },
    }
    const raw = await this.request<{ key: string }>('POST', '/rest/api/3/issue', body)
    return { key: raw.key }
  }

  async transitionIssue(input: { issueKey: string; transitionId: string }): Promise<void> {
    await this.request(
      'POST',
      `/rest/api/3/issue/${encodeURIComponent(input.issueKey)}/transitions`,
      { transition: { id: input.transitionId } },
    )
  }

  async addComment(input: { issueKey: string; body: string }): Promise<void> {
    await this.request('POST', `/rest/api/3/issue/${encodeURIComponent(input.issueKey)}/comment`, {
      body: toAdf(input.body),
    })
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new ProviderApiError('jira', response.status, text)
    }
    if (response.status === 204) return undefined as T
    const text = await response.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  }
}

// --- JQL builder ----------------------------------------------------------

function buildJql(filter: JiraSearchFilter): string {
  const clauses: string[] = []
  if (filter.projectKey) clauses.push(`project = ${quote(filter.projectKey)}`)
  if (filter.assignee === 'currentUser') {
    clauses.push('assignee = currentUser()')
  } else if (filter.assignee) {
    clauses.push(`assignee = ${quote(filter.assignee)}`)
  }
  if (filter.openOnly) clauses.push('statusCategory != Done')
  clauses.push('order by updated DESC')
  return clauses.join(' AND ').replace(' AND order by', ' order by')
}

function quote(s: string): string {
  // JQL uses double-quotes; escape any embedded ones.
  return `"${s.replace(/"/g, '\\"')}"`
}

// --- ADF helper -----------------------------------------------------------

/** Wrap a plain string into the minimal ADF document Jira v3 expects. */
function toAdf(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  }
}

// --- raw response shapes (narrow — only fields we use) --------------------

interface RawUser {
  accountId: string
  displayName: string
  emailAddress?: string
}

interface RawProject {
  id: string
  key: string
  name: string
}

interface RawStatus {
  id: string
  name: string
  statusCategory?: { key?: string }
}

interface RawIssueTypeStatuses {
  id: string
  name: string
  statuses: RawStatus[]
}

interface RawTransition {
  id: string
  name: string
  to: RawStatus
}

interface RawIssue {
  id: string
  key: string
  fields: {
    summary: string
    status: RawStatus
    assignee: RawUser | null
    updated: string
  }
}

function mapUser(raw: RawUser): JiraUser {
  return {
    accountId: raw.accountId,
    displayName: raw.displayName,
    ...(raw.emailAddress ? { emailAddress: raw.emailAddress } : {}),
  }
}

function mapStatus(raw: RawStatus): JiraStatus {
  const cat = raw.statusCategory?.key
  const category: JiraStatus['category'] =
    cat === 'new' || cat === 'indeterminate' || cat === 'done' ? cat : 'unknown'
  return { id: raw.id, name: raw.name, category }
}

function mapIssue(raw: RawIssue): JiraIssue {
  return {
    key: raw.key,
    id: raw.id,
    summary: raw.fields.summary,
    status: mapStatus(raw.fields.status),
    assignee: raw.fields.assignee ? mapUser(raw.fields.assignee) : null,
    updated: raw.fields.updated,
  }
}
