// GitHub Issues implementation of IssueTrackerProvider.
//
// API reference: https://docs.github.com/en/rest/issues
//
// Auth: Bearer token. In CI, ${{ secrets.GITHUB_TOKEN }} is auto-
// provided. Locally, generate a fine-grained PAT scoped to the target
// repo with Read+Write on Issues, or use `gh auth token`.
//
// Lifecycle model: GitHub Issues doesn't have transitions like Jira.
// We map slots to (state, label) pairs:
//   inProgress → open + label `status:in-progress` (strip other status:*)
//   inReview   → open + label `status:in-review`   (strip other status:*)
//   done       → closed (state_reason=completed) + strip status:* labels
//
// Issue keys are GitHub issue numbers. We accept "#42", "42", or
// "<repo>#42" on input and always emit "#42" as the display key.

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

export interface GitHubIssuesProviderOptions {
  /** Personal access token or GITHUB_TOKEN. */
  token: string
  /** "owner/name" — e.g. "rando-id/rando". */
  repo: string
  /** Lifecycle slot → label name. */
  labels: { inProgress: string; inReview: string }
  /** Override for tests. Defaults to global fetch. */
  fetch?: typeof fetch
  /** Override base URL for tests. */
  baseUrl?: string
}

const BASE_URL = 'https://api.github.com'

export class GitHubIssuesProvider implements IssueTrackerProvider {
  private readonly fetch: typeof fetch
  private readonly baseUrl: string
  private readonly owner: string
  private readonly repoName: string
  private readonly labels: { inProgress: string; inReview: string }
  private readonly authHeader: string

  constructor(opts: GitHubIssuesProviderOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch
    this.baseUrl = (opts.baseUrl ?? BASE_URL).replace(/\/+$/, '')
    const [owner, repoName] = opts.repo.split('/')
    if (!owner || !repoName) {
      throw new Error(`Invalid GitHub repo "${opts.repo}" — expected "owner/name".`)
    }
    this.owner = owner
    this.repoName = repoName
    this.labels = opts.labels
    this.authHeader = `Bearer ${opts.token}`
  }

  async getMyself(): Promise<TrackerUser> {
    const raw = await this.request<RawUser>('GET', '/user')
    return mapUser(raw)
  }

  async searchIssues(filter: IssueSearchFilter): Promise<Issue[]> {
    const params = new URLSearchParams({
      state: filter.openOnly ? 'open' : 'all',
      sort: 'updated',
      direction: 'desc',
      per_page: String(filter.limit ?? 50),
      // Filter out PRs — the issues endpoint returns both. We post-filter
      // in mapIssue and re-truncate the list.
      filter: 'all',
    })
    if (filter.assignee === 'currentUser') {
      // GitHub's `assignee` filter accepts a username or '*' for any.
      // For 'currentUser' we fetch the username once.
      const me = await this.getMyself()
      params.set('assignee', me.id)
    } else if (filter.assignee) {
      params.set('assignee', filter.assignee)
    }
    const raw = await this.request<RawIssue[]>(
      'GET',
      `/repos/${this.owner}/${this.repoName}/issues?${params.toString()}`,
    )
    return raw.filter((i) => !i.pull_request).map((i) => this.mapIssue(i))
  }

  async getIssue(key: string): Promise<Issue> {
    const number = parseIssueNumber(key, this.owner, this.repoName)
    const raw = await this.request<RawIssue>(
      'GET',
      `/repos/${this.owner}/${this.repoName}/issues/${number}`,
    )
    return this.mapIssue(raw)
  }

  async createIssue(input: {
    summary: string
    description?: string
    labels?: string[]
    milestone?: string
  }): Promise<{ key: string }> {
    const body: Record<string, unknown> = { title: input.summary }
    if (input.description) body.body = input.description
    if (input.labels?.length) body.labels = input.labels
    if (input.milestone) {
      body.milestone = await this.resolveMilestone(input.milestone)
    }
    const raw = await this.request<RawIssue>(
      'POST',
      `/repos/${this.owner}/${this.repoName}/issues`,
      body,
    )
    return { key: `#${raw.number}` }
  }

  /**
   * Resolve a milestone reference (numeric id OR title, case-insensitive)
   * to the numeric id the GitHub API expects in the issue body.
   */
  private async resolveMilestone(ref: string): Promise<number> {
    if (/^\d+$/.test(ref)) return parseInt(ref, 10)
    const milestones = await this.request<Array<{ number: number; title: string }>>(
      'GET',
      `/repos/${this.owner}/${this.repoName}/milestones?state=all&per_page=100`,
    )
    const match = milestones.find((m) => m.title.toLowerCase() === ref.toLowerCase())
    if (!match) {
      throw new Error(
        `Milestone "${ref}" not found in ${this.owner}/${this.repoName}. Use the numeric id or an exact title.`,
      )
    }
    return match.number
  }

  async applyLifecycle(input: { key: string; slot: LifecycleSlot }): Promise<LifecycleResult> {
    const number = parseIssueNumber(input.key, this.owner, this.repoName)
    const issue = await this.request<RawIssue>(
      'GET',
      `/repos/${this.owner}/${this.repoName}/issues/${number}`,
    )

    const currentStatusLabels = issue.labels
      .map((l) => l.name)
      .filter((n) => n.startsWith('status:'))

    if (input.slot === 'done') {
      if (issue.state === 'closed') {
        return { transitioned: false, status: 'closed', via: 'already closed' }
      }
      // Strip status:* labels + close.
      await this.removeStatusLabels(number, currentStatusLabels)
      await this.request('PATCH', `/repos/${this.owner}/${this.repoName}/issues/${number}`, {
        state: 'closed',
        state_reason: 'completed',
      })
      return { transitioned: true, status: 'closed', via: 'closed (completed)' }
    }

    // inProgress / inReview: ensure open + set the right label.
    const targetLabel = input.slot === 'inProgress' ? this.labels.inProgress : this.labels.inReview

    const alreadyOpen = issue.state === 'open'
    const alreadyLabeled = currentStatusLabels.includes(targetLabel)
    if (alreadyOpen && alreadyLabeled && currentStatusLabels.length === 1) {
      return { transitioned: false, status: `open + ${targetLabel}`, via: 'already there' }
    }

    if (!alreadyOpen) {
      await this.request('PATCH', `/repos/${this.owner}/${this.repoName}/issues/${number}`, {
        state: 'open',
      })
    }
    // Remove any other status:* labels (but keep targetLabel if already present).
    const toRemove = currentStatusLabels.filter((n) => n !== targetLabel)
    if (toRemove.length) await this.removeStatusLabels(number, toRemove)
    if (!alreadyLabeled) {
      await this.request('POST', `/repos/${this.owner}/${this.repoName}/issues/${number}/labels`, {
        labels: [targetLabel],
      })
    }
    return {
      transitioned: true,
      status: `open + ${targetLabel}`,
      via: `label set to ${targetLabel}`,
    }
  }

  async addComment(input: { key: string; body: string }): Promise<void> {
    const number = parseIssueNumber(input.key, this.owner, this.repoName)
    await this.request('POST', `/repos/${this.owner}/${this.repoName}/issues/${number}/comments`, {
      body: input.body,
    })
  }

  async doctor(): Promise<TrackerDoctorReport> {
    const me = await this.getMyself()
    const repo = await this.request<RawRepo>('GET', `/repos/${this.owner}/${this.repoName}`)
    // List existing labels in the repo so doctor can lint whether the
    // configured status labels are actually defined (GitHub auto-
    // creates labels on add, so missing is just a warning, not an error).
    const allLabels = await this.request<Array<{ name: string }>>(
      'GET',
      `/repos/${this.owner}/${this.repoName}/labels?per_page=100`,
    )
    const labelNames = new Set(allLabels.map((l) => l.name))

    const statuses: TrackerDoctorReport['statuses'] = [
      { name: 'open (no status label)', category: 'open' },
      { name: `open + ${this.labels.inProgress}`, category: 'in-progress' },
      { name: `open + ${this.labels.inReview}`, category: 'in-review' },
      { name: 'closed', category: 'done' },
    ]

    const lifecycle: TrackerDoctorReport['lifecycle'] = [
      {
        slot: 'inProgress',
        value: this.labels.inProgress,
        resolved: labelNames.has(this.labels.inProgress),
        note: labelNames.has(this.labels.inProgress)
          ? `label exists in ${repo.full_name}`
          : '(label not defined yet — auto-created on first apply)',
      },
      {
        slot: 'inReview',
        value: this.labels.inReview,
        resolved: labelNames.has(this.labels.inReview),
        note: labelNames.has(this.labels.inReview)
          ? `label exists in ${repo.full_name}`
          : '(label not defined yet — auto-created on first apply)',
      },
      {
        slot: 'done',
        value: 'closed (state_reason=completed)',
        resolved: true,
        note: '(intrinsic — GitHub close-with-reason)',
      },
    ]

    return {
      authedAs: `${me.displayName} (${me.emailAddress ?? me.id})`,
      projectLabel: `Repo: ${repo.full_name}`,
      statuses,
      lifecycle,
    }
  }

  // ─── internals ─────────────────────────────────────────────────────────

  private async removeStatusLabels(number: number, labels: string[]): Promise<void> {
    // Issue one DELETE per label — GitHub doesn't expose a bulk remove.
    // Sequential so a rate-limit hit on one doesn't fan out failures.
    for (const label of labels) {
      await this.request(
        'DELETE',
        `/repos/${this.owner}/${this.repoName}/issues/${number}/labels/${encodeURIComponent(label)}`,
      )
    }
  }

  private mapIssue(raw: RawIssue): Issue {
    const statusLabels = raw.labels.map((l) => l.name).filter((n) => n.startsWith('status:'))
    let category: Issue['statusCategory'] = 'open'
    let statusName = raw.state === 'closed' ? 'closed' : 'open'
    if (raw.state === 'closed') {
      category = 'done'
    } else if (statusLabels.includes(this.labels.inProgress)) {
      category = 'in-progress'
      statusName = `open + ${this.labels.inProgress}`
    } else if (statusLabels.includes(this.labels.inReview)) {
      category = 'in-review'
      statusName = `open + ${this.labels.inReview}`
    }
    return {
      key: `#${raw.number}`,
      id: String(raw.id),
      summary: raw.title,
      status: statusName,
      statusCategory: category,
      assignee: raw.assignee ? mapUser(raw.assignee) : null,
      updated: raw.updated_at,
      url: raw.html_url,
    }
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'rando-cli',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new ProviderApiError('github', response.status, text)
    }
    if (response.status === 204) return undefined as T
    const text = await response.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  }
}

// ─── key parsing ───────────────────────────────────────────────────────

/**
 * Accept "#42", "42", or "owner/repo#42" and return the numeric id.
 * Cross-repo refs are allowed in input but the adapter is bound to one
 * repo — we error if the owner/repo doesn't match.
 */
function parseIssueNumber(key: string, owner: string, repoName: string): number {
  const trimmed = key.trim()
  // owner/repo#N form
  const crossMatch = trimmed.match(/^([^/]+)\/([^#]+)#(\d+)$/)
  if (crossMatch) {
    if (crossMatch[1] !== owner || crossMatch[2] !== repoName) {
      throw new Error(
        `Issue key "${key}" references ${crossMatch[1]}/${crossMatch[2]} but this adapter is bound to ${owner}/${repoName}.`,
      )
    }
    return parseInt(crossMatch[3]!, 10)
  }
  // #N or plain N
  const num = trimmed.replace(/^#/, '')
  if (!/^\d+$/.test(num)) {
    throw new Error(`Invalid GitHub issue key "${key}" — expected #N or N.`)
  }
  return parseInt(num, 10)
}

// ─── raw response shapes ───────────────────────────────────────────────

interface RawUser {
  login: string
  name?: string | null
  email?: string | null
}

interface RawRepo {
  full_name: string
}

interface RawIssue {
  id: number
  number: number
  title: string
  state: 'open' | 'closed'
  labels: Array<{ name: string }>
  assignee: RawUser | null
  updated_at: string
  html_url: string
  /** Present when the "issue" is actually a PR. We filter these out. */
  pull_request?: unknown
}

function mapUser(raw: RawUser): TrackerUser {
  return {
    id: raw.login,
    displayName: raw.name ?? raw.login,
    ...(raw.email ? { emailAddress: raw.email } : {}),
  }
}
