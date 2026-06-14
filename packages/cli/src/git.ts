// Thin shell-out wrappers around `git` for things the CLI needs to know
// about the current working tree. Kept narrow + injectable so unit tests
// can stub the exec call without spinning up a real repo.
//
// All functions are best-effort: they swallow git errors (e.g. detached
// HEAD, not a git repo, missing config) and return null. Callers decide
// whether absence is a real problem.

import { execFileSync } from 'node:child_process'

export interface GitRunner {
  /**
   * Run `git <args...>` and return trimmed stdout, or `null` if git
   * exited non-zero (which usually means "no such config", "not a repo",
   * or "detached HEAD" — all of which are recoverable from the CLI's
   * point of view).
   */
  run(args: string[]): string | null
}

export const defaultGitRunner: GitRunner = {
  run(args) {
    try {
      return execFileSync('git', args, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      return null
    }
  },
}

/** Current branch name, or null if detached / not in a repo. */
export function getCurrentBranch(git: GitRunner = defaultGitRunner): string | null {
  const out = git.run(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!out || out === 'HEAD') return null
  return out
}

/**
 * Per-branch ticket key cached in git config under
 * `branch.<name>.jira-key`. Returns the cached key (e.g. "RANDO-42"),
 * the special sentinel "skip" (user opted out for this branch), or null
 * if nothing is set.
 */
export function getCachedJiraKey(branch: string, git: GitRunner = defaultGitRunner): string | null {
  return git.run(['config', `branch.${branch}.jira-key`])
}

/** Persist a ticket key (or the "skip" sentinel) for a branch. */
export function setCachedJiraKey(
  branch: string,
  key: string,
  git: GitRunner = defaultGitRunner,
): void {
  // Use --replace-all so a second call overwrites instead of appending a
  // second value (which `git config` would otherwise complain about).
  git.run(['config', '--replace-all', `branch.${branch}.jira-key`, key])
}

/** Remove the cached ticket key for a branch. */
export function unsetCachedJiraKey(branch: string, git: GitRunner = defaultGitRunner): void {
  git.run(['config', '--unset', `branch.${branch}.jira-key`])
}

/** Sentinel value stored in git config when the user opts out for a branch. */
export const JIRA_SKIP_SENTINEL = 'skip'

export interface GitCommit {
  sha: string
  /** ISO 8601 author date. */
  date: string
  /** First line of the message. */
  subject: string
  /** Everything after the subject; '' if the commit has no body. */
  body: string
}

/**
 * Walk first-parent commits on a branch, newest first. Used by backfill
 * to enumerate the work that should retroactively get tickets. Returns
 * an empty array when git fails (not a repo, bad ref, etc.).
 *
 * `range` (e.g. "BASE..HEAD") wins over both `since` and `branch` and
 * is passed straight through to git — used by CI to scope a PR.
 */
export function listCommits(
  input: { branch?: string; since?: string; limit?: number; range?: string },
  git: GitRunner = defaultGitRunner,
): GitCommit[] {
  // ASCII record separators so commit subjects with newlines or pipes
  // can't break the parser.
  const FIELD = '\x1f' // unit separator
  const RECORD = '\x1e' // record separator
  const format = `%H${FIELD}%aI${FIELD}%s${FIELD}%b${RECORD}`
  const args = ['log', '--first-parent', `--pretty=format:${format}`]
  if (input.limit) args.push(`-n`, String(input.limit))
  if (input.range) args.push(input.range)
  else if (input.since) args.push(`${input.since}..HEAD`)
  else if (input.branch) args.push(input.branch)
  const raw = git.run(args)
  if (!raw) return []
  return raw
    .split(RECORD)
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((record): GitCommit => {
      const [sha = '', date = '', subject = '', body = ''] = record.split(FIELD)
      return { sha, date, subject, body: body.trim() }
    })
}

/**
 * Pull issue keys out of `Fixes:` / `Closes:` / `Resolves:` / `Refs:`
 * footers in a commit message. Accepts:
 *   - GitHub keys: `#42`
 *   - Jira keys:   `RANDO-42`
 *
 * Multi-ticket commits use comma or whitespace separation
 * (`Fixes: #5, #6` or `Fixes: #5 #6`). Leading whitespace on the
 * footer line is tolerated (some editors strip, some don't).
 *
 * The Fixes/Closes/Resolves keywords are GitHub's auto-close
 * trigger words — recognized server-side on PR merge. Refs is
 * kept as a back-compat alias for any existing history.
 */
export function parseJiraRefs(message: string): string[] {
  const keys: string[] = []
  for (const line of message.split('\n')) {
    const m = line.match(/^\s*(?:Fixes|Closes|Resolves|Refs):\s*(.+?)\s*$/i)
    if (!m) continue
    for (const part of (m[1] ?? '').split(/[,\s]+/)) {
      const trimmed = part.trim()
      if (/^#\d+$/.test(trimmed) || /^[A-Z][A-Z0-9_]*-\d+$/.test(trimmed)) {
        keys.push(trimmed)
      }
    }
  }
  return keys
}
