// Jira ticket-tracker domain interface. Implemented by vendor-specific
// adapters (only Jira Cloud for now; self-hosted Jira Server / Data Center
// uses different auth + API paths and would need its own adapter).
//
// All operations are scoped to a single Jira site (one workspace per
// rando.config.json `jira.baseUrl`).

export interface JiraUser {
  /** Atlassian account id — stable, opaque. Used as `assignee` filter. */
  accountId: string
  /** Display name. Not unique. */
  displayName: string
  emailAddress?: string
}

export interface JiraProject {
  /** Project key, e.g. "RANDO". Stable; used in issue keys. */
  key: string
  /** Internal id; the API often accepts either. */
  id: string
  name: string
}

export interface JiraStatus {
  /** Status id (numeric string). Stable across renames. */
  id: string
  name: string
  category: 'new' | 'indeterminate' | 'done' | 'unknown'
}

export interface JiraTransition {
  /** Transition id — what you POST to actually move the issue. */
  id: string
  /** UI name of the transition (e.g. "Start progress"). */
  name: string
  /** The status the issue lands in after this transition runs. */
  to: JiraStatus
}

export interface JiraIssue {
  key: string
  id: string
  summary: string
  status: JiraStatus
  assignee: JiraUser | null
  /** ISO timestamp. */
  updated: string
}

export interface JiraSearchFilter {
  /** Restrict to this project key. Defaults to the configured project. */
  projectKey?: string
  /** Restrict to issues assigned to a specific accountId, or 'currentUser'. */
  assignee?: string | 'currentUser'
  /** Exclude issues whose status category is `done`. */
  openOnly?: boolean
  /** Max number of issues to return. Defaults to 50. */
  limit?: number
}

export interface JiraProvider {
  /** Verify auth + return the authenticated user. */
  getMyself(): Promise<JiraUser>

  /** Fetch a project by its key (e.g. "RANDO"). */
  getProject(key: string): Promise<JiraProject>

  /**
   * List status values defined for this project's workflows. Statuses are
   * scoped per issue-type but we flatten + dedupe since the CLI doesn't
   * care which issue type. Used by `doctor` to help the user populate
   * the transitions map in rando.config.json.
   */
  listStatuses(projectKey: string): Promise<JiraStatus[]>

  /** List the transitions currently available for one issue. */
  listTransitions(issueKey: string): Promise<JiraTransition[]>

  /** Search issues using the filter. Server-side JQL. */
  searchIssues(filter: JiraSearchFilter): Promise<JiraIssue[]>

  /** Fetch one issue by key. */
  getIssue(key: string): Promise<JiraIssue>

  /** Create a new issue. Returns the new issue's key. */
  createIssue(input: {
    projectKey: string
    summary: string
    /** Plain text — adapter wraps into ADF / vendor format as needed. */
    description?: string
    issueType?: string
    /** Optional Jira labels — useful for filtering backfilled tickets. */
    labels?: string[]
  }): Promise<{ key: string }>

  /** Execute a transition on an issue. */
  transitionIssue(input: { issueKey: string; transitionId: string }): Promise<void>

  /** Add a plain-text comment to an issue. */
  addComment(input: { issueKey: string; body: string }): Promise<void>
}
