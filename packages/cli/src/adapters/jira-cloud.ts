// Jira Cloud (https://<your>.atlassian.net) implementation of
// IssueTrackerProvider. API reference:
//   https://developer.atlassian.com/cloud/jira/platform/rest/v3/
//
// Auth: HTTP Basic with `<email>:<api-token>` base64-encoded. The API
// token is generated at
// https://id.atlassian.com/manage-profile/security/api-tokens — per-user,
// not per-project.
//
// v3 endpoints take Atlassian Document Format (ADF) — a structured JSON
// document — for description / comment bodies. Plain strings get wrapped
// into a minimal one-paragraph ADF doc so callers don't have to know.
//
// "Transitions" and "statuses" are Jira-internal concepts that don't
// leak past this file — applyLifecycle() handles them privately.

import { ProviderApiError } from '../domain/errors'
import type {
  Issue,
  IssueSearchFilter,
  IssueTrackerProvider,
  LifecycleResult,
  LifecycleSlot,
  TrackerDoctorReport,
  TrackerUser,
} from '../domain/tracker'

export interface JiraCloudProviderOptions {
  /** Site URL: https://<workspace>.atlassian.net (no trailing slash). */
  baseUrl: string
  /** Atlassian account email. */
  email: string
  /** API token. */
  apiToken: string
  /** Project key (e.g. "RANDO"). The adapter is bound to one project. */
  projectKey: string
  /**
   * Lifecycle slot → transition name (case-insensitive) or transition id.
   * Slots not in the map can still be invoked but applyLifecycle will
   * throw a clear "no jira.transitions.<slot> configured" error.
   */
  transitions: Partial<Record<LifecycleSlot, string>>
  /** Override for tests. Defaults to global fetch. */
  fetch?: typeof fetch
}

const LIFECYCLE_LABELS: Record<LifecycleSlot, string> = {
  inProgress: 'inProgress',
  inReview: 'inReview',
  done: 'done',
}

export class JiraCloudProvider implements IssueTrackerProvider {
  private readonly fetch: typeof fetch
  private readonly baseUrl: string
  private readonly authHeader: string
  private readonly projectKey: string
  private readonly transitions: Partial<Record<LifecycleSlot, string>>

  constructor(opts: JiraCloudProviderOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.authHeader = `Basic ${Buffer.from(`${opts.email}:${opts.apiToken}`).toString('base64')}`
    this.projectKey = opts.projectKey
    this.transitions = opts.transitions
  }

  async getMyself(): Promise<TrackerUser> {
    const raw = await this.request<RawUser>('GET', '/rest/api/3/myself')
    return mapUser(raw)
  }

  async searchIssues(filter: IssueSearchFilter): Promise<Issue[]> {
    const jql = buildJql({ ...filter, projectKey: this.projectKey })
    const params = new URLSearchParams({
      jql,
      fields: 'summary,status,assignee,updated',
      maxResults: String(filter.limit ?? 50),
    })
    const raw = await this.request<{ issues: RawIssue[] }>(
      'GET',
      `/rest/api/3/search/jql?${params.toString()}`,
    )
    return raw.issues.map((i) => this.mapIssue(i))
  }

  async getIssue(key: string): Promise<Issue> {
    const params = new URLSearchParams({ fields: 'summary,status,assignee,updated' })
    const raw = await this.request<RawIssue>(
      'GET',
      `/rest/api/3/issue/${encodeURIComponent(key)}?${params.toString()}`,
    )
    return this.mapIssue(raw)
  }

  async createIssue(input: {
    summary: string
    description?: string
    labels?: string[]
    issueType?: string
    /**
     * Milestones don't have a direct equivalent in Jira — the closest
     * is "fix versions" which require setup outside the scope of this
     * adapter. We raise a clear error so callers know to drop the flag.
     */
    milestone?: string
  }): Promise<{ key: string }> {
    if (input.milestone) {
      throw new Error(
        'Milestones are not supported by the Jira adapter (closest equivalent is fix versions). Drop the --milestone flag or switch tracker.kind to "github".',
      )
    }
    const body: Record<string, unknown> = {
      fields: {
        project: { key: this.projectKey },
        summary: input.summary,
        issuetype: { name: input.issueType ?? 'Task' },
        ...(input.description ? { description: toAdf(input.description) } : {}),
        ...(input.labels?.length ? { labels: input.labels } : {}),
      },
    }
    const raw = await this.request<{ key: string }>('POST', '/rest/api/3/issue', body)
    return { key: raw.key }
  }

  async applyLifecycle(input: { key: string; slot: LifecycleSlot }): Promise<LifecycleResult> {
    const configured = this.transitions[input.slot]
    if (!configured) {
      throw new Error(
        `No tracker.jira.transitions.${LIFECYCLE_LABELS[input.slot]} configured in rando.config.json — run \`rando issues doctor\` to see what's available.`,
      )
    }
    // Fetch the available transitions AND the current issue in
    // parallel — we need both to detect the self-loop case where the
    // configured transition's target is the current status (default
    // Jira workflows allow this; firing it would just spam the audit
    // log).
    const [transitions, issue] = await Promise.all([
      this.listTransitions(input.key),
      this.getIssue(input.key),
    ])

    const match = transitions.find(
      (t) => t.id === configured || t.name.toLowerCase() === configured.toLowerCase(),
    )

    if (match && match.to.name.toLowerCase() === issue.status.toLowerCase()) {
      return { transitioned: false, status: issue.status, via: `already at ${issue.status}` }
    }
    if (!match) {
      return {
        transitioned: false,
        status: issue.status,
        via: `transition "${configured}" not available from ${issue.status}`,
      }
    }
    await this.request('POST', `/rest/api/3/issue/${encodeURIComponent(input.key)}/transitions`, {
      transition: { id: match.id },
    })
    return { transitioned: true, status: match.to.name, via: `via "${match.name}"` }
  }

  async addComment(input: { key: string; body: string }): Promise<void> {
    await this.request('POST', `/rest/api/3/issue/${encodeURIComponent(input.key)}/comment`, {
      body: toAdf(input.body),
    })
  }

  async doctor(): Promise<TrackerDoctorReport> {
    const me = await this.getMyself()
    const project = await this.request<RawProject>(
      'GET',
      `/rest/api/3/project/${encodeURIComponent(this.projectKey)}`,
    )
    const statuses = await this.fetchStatuses()
    // Sample one open issue so we can resolve lifecycle slots against
    // its available transitions (transitions are issue-state-dependent
    // in Jira).
    const sample = await this.searchIssues({ openOnly: true, limit: 1 })
    const sampleKey = sample[0]?.key
    const availableTransitions = sampleKey ? await this.listTransitions(sampleKey) : []

    const lifecycle: TrackerDoctorReport['lifecycle'] = (
      ['inProgress', 'inReview', 'done'] as const
    ).map((slot) => {
      const value = this.transitions[slot] ?? null
      if (!value) return { slot, value: null, resolved: false, note: '(unset)' }
      const byId = availableTransitions.find((t) => t.id === value)
      if (byId) {
        return { slot, value, resolved: true, note: `→ ${byId.to.name} (id ${byId.id})` }
      }
      const byName = availableTransitions.find((t) => t.name.toLowerCase() === value.toLowerCase())
      if (byName) {
        return { slot, value, resolved: true, note: `→ ${byName.to.name} (id ${byName.id})` }
      }
      return { slot, value, resolved: false, note: '(no match in available transitions)' }
    })

    return {
      authedAs: `${me.displayName} (${me.emailAddress ?? me.id})`,
      projectLabel: `Project: ${project.key} (${project.name})`,
      statuses: statuses.map((s) => ({
        name: s.name,
        category: mapStatusCategory(s.statusCategory?.key),
      })),
      lifecycle,
    }
  }

  // ─── internals ─────────────────────────────────────────────────────────

  private async listTransitions(issueKey: string): Promise<RawTransition[]> {
    const raw = await this.request<{ transitions: RawTransition[] }>(
      'GET',
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    )
    return raw.transitions
  }

  private async fetchStatuses(): Promise<RawStatus[]> {
    const raw = await this.request<RawIssueTypeStatuses[]>(
      'GET',
      `/rest/api/3/project/${encodeURIComponent(this.projectKey)}/statuses`,
    )
    const seen = new Map<string, RawStatus>()
    for (const it of raw) for (const s of it.statuses) if (!seen.has(s.id)) seen.set(s.id, s)
    return [...seen.values()]
  }

  private mapIssue(raw: RawIssue): Issue {
    return {
      key: raw.key,
      id: raw.id,
      summary: raw.fields.summary,
      status: raw.fields.status.name,
      statusCategory: mapStatusCategory(raw.fields.status.statusCategory?.key),
      assignee: raw.fields.assignee ? mapUser(raw.fields.assignee) : null,
      updated: raw.fields.updated,
      url: `${this.baseUrl}/browse/${raw.key}`,
    }
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

// ─── JQL builder ────────────────────────────────────────────────────────

function buildJql(filter: IssueSearchFilter & { projectKey: string }): string {
  const clauses: string[] = [`project = ${quote(filter.projectKey)}`]
  if (filter.assignee === 'currentUser') clauses.push('assignee = currentUser()')
  else if (filter.assignee) clauses.push(`assignee = ${quote(filter.assignee)}`)
  if (filter.openOnly) clauses.push('statusCategory != Done')
  return `${clauses.join(' AND ')} order by updated DESC`
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`
}

// ─── ADF helper ────────────────────────────────────────────────────────

function toAdf(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

// ─── status category mapping ───────────────────────────────────────────

function mapStatusCategory(key: string | undefined): Issue['statusCategory'] {
  // Jira's category keys are: new, indeterminate, done, undefined.
  // We map indeterminate → 'in-progress' as a sensible default; the
  // CLI only really cares about distinguishing 'done' vs everything else.
  if (key === 'done') return 'done'
  if (key === 'new') return 'open'
  if (key === 'indeterminate') return 'in-progress'
  return 'other'
}

// ─── raw response shapes (narrow — only fields we use) ────────────────

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

function mapUser(raw: RawUser): TrackerUser {
  return {
    id: raw.accountId,
    displayName: raw.displayName,
    ...(raw.emailAddress ? { emailAddress: raw.emailAddress } : {}),
  }
}
