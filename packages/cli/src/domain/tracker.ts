// Issue-tracker domain interface. Implemented by vendor adapters
// (GitHub Issues, Jira Cloud, etc.). Adapters are constructed bound to
// a single project/repo so callers never have to thread a project key
// through every call.
//
// The lifecycle slots (in-progress, in-review, done) are the *only*
// state machine the CLI cares about. Each adapter maps them to its
// own model — for Jira that's a transition; for GitHub it's
// open/closed + a label. The CLI never sees those vendor specifics.

export interface TrackerUser {
  /** Stable, opaque id. Used as the `assignee` filter. */
  id: string
  /** Display name (not unique). */
  displayName: string
  emailAddress?: string
}

export interface Issue {
  /** Human-readable key — "RANDO-42" for Jira, "#42" for GitHub. */
  key: string
  /** Internal id (opaque). */
  id: string
  summary: string
  /** Human-readable status name as the tracker reports it. */
  status: string
  /**
   * Coarse category — adapters bucket their own statuses into one of
   * these so the CLI can color/sort consistently across providers.
   */
  statusCategory: 'open' | 'in-progress' | 'in-review' | 'done' | 'other'
  assignee: TrackerUser | null
  /** ISO timestamp. */
  updated: string
  /** Direct link in the vendor UI. Adapters fill this in. */
  url?: string
}

export interface IssueSearchFilter {
  /** Restrict to issues assigned to a specific id, or 'currentUser'. */
  assignee?: string | 'currentUser'
  /** Exclude issues that are in the `done` category. */
  openOnly?: boolean
  /** Max number of issues to return. Adapters apply a sensible default. */
  limit?: number
}

export type LifecycleSlot = 'inProgress' | 'inReview' | 'done'

export interface LifecycleResult {
  /**
   * False when the issue was already in the target state and no API
   * write happened — the idempotency path the CI workflows rely on.
   */
  transitioned: boolean
  /** Status name the issue is in *after* this call. */
  status: string
  /**
   * Adapter-specific note rendered alongside the result.
   * Examples: 'via "Start progress"' for Jira, 'label set' for GitHub.
   */
  via?: string
}

/**
 * Diagnostic snapshot returned by `IssueTrackerProvider.doctor()`. The
 * `rando issues doctor` command renders these uniformly.
 */
export interface TrackerDoctorReport {
  /** "Authenticated as ..." subject for the spinner. */
  authedAs: string
  /** Free-form "Project: RANDO" / "Repo: rando-id/rando" identifier. */
  projectLabel: string
  /** Status values the adapter exposes. */
  statuses: Array<{ name: string; category: Issue['statusCategory'] }>
  /**
   * Per-lifecycle-slot readiness check. `null` value means "not
   * configured"; a string is the configured raw value the adapter
   * sees. `resolved` indicates whether that value actually maps to
   * something the tracker recognizes.
   */
  lifecycle: Array<{
    slot: LifecycleSlot
    value: string | null
    resolved: boolean
    /** Hint to print alongside, e.g. '→ In Progress' or '(no match)'. */
    note: string
  }>
}

export interface IssueTrackerProvider {
  /** Verify auth + return the authenticated user. */
  getMyself(): Promise<TrackerUser>

  /** Search issues using the filter. */
  searchIssues(filter: IssueSearchFilter): Promise<Issue[]>

  /** Fetch one issue by key. */
  getIssue(key: string): Promise<Issue>

  /** Create a new issue. Returns the new issue's key. */
  createIssue(input: {
    summary: string
    /** Plain text/markdown — adapter wraps into vendor format as needed. */
    description?: string
    /** Optional vendor labels. */
    labels?: string[]
    /**
     * Optional milestone — accepts either a numeric id ("2") or a
     * title ("v0.1 — Feature parity"). Adapters that don't support
     * milestones (Jira) raise a clear error.
     */
    milestone?: string
  }): Promise<{ key: string }>

  /**
   * Move an issue through one of the lifecycle slots. Idempotent —
   * `transitioned: false` is the no-op signal CI re-fires rely on.
   */
  applyLifecycle(input: { key: string; slot: LifecycleSlot }): Promise<LifecycleResult>

  /** Add a plain-text/markdown comment. */
  addComment(input: { key: string; body: string }): Promise<void>

  /** Adapter-specific diagnostic snapshot for `rando issues doctor`. */
  doctor(): Promise<TrackerDoctorReport>
}
