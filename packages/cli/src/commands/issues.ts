// `rando issues` — provider-agnostic issue-tracker integration.
//
// The active provider is decided by `tracker.kind` in rando.config.json
// (currently "jira"; "github" lands in phase B). Each command in here
// only sees the IssueTrackerProvider interface — vendor specifics live
// in the adapter.
//
// Subcommands:
//   list:       list issues (filter by --mine / --all / --limit)
//   show:       fetch one issue by key
//   create:     create a new ticket (summary + optional description)
//   comment:    post a comment
//   pick:       pick (or create / skip) the ticket for the current branch
//   refs:       extract ticket keys from a git range — used by CI
//   lifecycle:  move an issue through one of the lifecycle slots
//   backfill:   retroactively create one ticket per first-parent commit
//   doctor:     verify auth, print config diagnostic
//
// `lifecycle`, `pick`, and `doctor` are the surfaces the commit hook +
// GitHub Actions workflows compose. Keep them stable.

import { Command } from 'commander'
import type { Adapters } from '../config'
import type { IssueTrackerProvider, LifecycleSlot } from '../domain/tracker'
import {
  defaultGitRunner,
  getCachedJiraKey,
  getCurrentBranch,
  JIRA_SKIP_SENTINEL,
  listCommits,
  parseJiraRefs,
  setCachedJiraKey,
  unsetCachedJiraKey,
  type GitCommit,
  type GitRunner,
} from '../git'
import { emit, table, type Io, type SelectChoice } from '../output'
import { loadSetupConfig } from '../setup-config'
import { askOr } from './_interactive'

const DEFAULT_CONFIG_PATH = 'rando.config.json'

export interface IssuesCommandDeps {
  /** Injected git runner — tests override to avoid shelling out. */
  git?: GitRunner
}

const LIFECYCLE_SLOTS = ['in-progress', 'in-review', 'done'] as const

function parseSlot(raw: string): LifecycleSlot {
  const norm = raw.replace(/-/g, '').toLowerCase()
  if (norm === 'inprogress') return 'inProgress'
  if (norm === 'inreview') return 'inReview'
  if (norm === 'done') return 'done'
  throw new Error(
    `Invalid lifecycle slot "${raw}". Expected one of: ${LIFECYCLE_SLOTS.join(', ')}.`,
  )
}

export function issuesCommand(adapters: Adapters, io: Io, deps: IssuesCommandDeps = {}): Command {
  const git = deps.git ?? defaultGitRunner
  const cmd = new Command('issues').description('Issue tracker (Jira / GitHub) integration')

  cmd
    .command('pick')
    .description(
      'Pick an issue for the current branch. Caches the choice in git config so subsequent commits auto-append Refs: <KEY>. Companion to the prepare-commit-msg hook.',
    )
    .option('--limit <n>', 'Max issues to show in the picker', (v) => parseInt(v, 10), 20)
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--reset', 'Clear the cached key for the current branch and exit', false)
    .option(
      '--from-hook',
      'Invoked by the prepare-commit-msg hook — softens missing-config into a no-op exit so a half-configured repo never blocks `git commit`.',
      false,
    )
    .option(
      '--check',
      'Probe mode used by the commit hook. Exits 0 if the tracker is fully configured. Does not prompt or modify state.',
      false,
    )
    .action(
      async (opts: {
        limit: number
        config: string
        reset: boolean
        fromHook: boolean
        check: boolean
      }) => {
        // --check: zero side-effects, just confirms the tracker is wired.
        if (opts.check) {
          try {
            adapters.tracker({ configPath: opts.config })
          } catch (e) {
            throw new Error(
              `Issue tracker not configured (${e instanceof Error ? e.message : String(e)})`,
            )
          }
          return
        }

        const branch = getCurrentBranch(git)
        if (!branch) {
          io.stderr(
            io.colors.hint(
              '(no current branch — detached HEAD or not a git repo; skipping ticket pick)',
            ),
          )
          return
        }

        if (opts.reset) {
          unsetCachedJiraKey(branch, git)
          io.stdout(
            `${io.colors.success('✓')} cleared cached ticket for ${io.colors.resource(branch)}`,
          )
          return
        }

        const existing = getCachedJiraKey(branch, git)
        if (existing && !opts.fromHook) {
          io.stdout(
            `${io.colors.hint(`(branch ${branch} already cached: ${existing}; pass --reset to clear)`)}`,
          )
          return
        }
        if (existing && opts.fromHook) return

        let provider: IssueTrackerProvider
        try {
          provider = adapters.tracker({ configPath: opts.config })
        } catch (e) {
          if (opts.fromHook) {
            io.stderr(
              io.colors.hint(
                `(tracker not configured — commit proceeds without Refs: footer; ${e instanceof Error ? e.message : String(e)})`,
              ),
            )
            return
          }
          throw e
        }

        const issues = await provider.searchIssues({
          assignee: 'currentUser',
          openOnly: true,
          limit: opts.limit,
        })

        const CREATE_NEW = '__create_new__'
        const SKIP = '__skip__'
        const choices: SelectChoice<string>[] = [
          ...issues.map(
            (i): SelectChoice<string> => ({
              name: `${i.key}  ${truncate(i.summary, 60)}`,
              value: i.key,
              description: i.status,
            }),
          ),
          { name: '+ Create a new ticket', value: CREATE_NEW },
          { name: 'Skip for this branch (no ticket)', value: SKIP },
        ]

        const choice = await io.select(`Ticket for branch ${io.colors.resource(branch)}:`, choices)

        if (choice === SKIP) {
          setCachedJiraKey(branch, JIRA_SKIP_SENTINEL, git)
          io.stdout(
            io.colors.hint(
              `skipped — commits on ${branch} will not get a Refs: footer (run \`rando issues pick --reset\` to undo)`,
            ),
          )
          return
        }

        let chosenKey = choice
        if (choice === CREATE_NEW) {
          const summary = await askOr(io, undefined, 'New ticket summary:', 'summary')
          const created = await provider.createIssue({ summary })
          chosenKey = created.key
          io.stdout(
            `${io.colors.success('✓')} created ${io.colors.resource(chosenKey)} ${io.colors.hint(`(${summary})`)}`,
          )
        }

        setCachedJiraKey(branch, chosenKey, git)
        io.stdout(
          `${io.colors.success('✓')} ${io.colors.resource(chosenKey)} cached for branch ${io.colors.resource(branch)} — commits will append \`Refs: ${chosenKey}\``,
        )
      },
    )

  cmd
    .command('refs <range>')
    .description(
      'Extract unique issue keys from `Refs:` footers in the given git range (e.g. "main..HEAD" or "<base-sha>..<head-sha>"). Used by CI to enumerate tickets touched by a PR.',
    )
    .option('--json', 'Emit a JSON array (one key per element)', false)
    .action(async (range: string, opts: { json: boolean }) => {
      const commits = listCommits({ range }, git)
      const seen = new Set<string>()
      const keys: string[] = []
      for (const c of commits) {
        const full = c.body ? `${c.subject}\n\n${c.body}` : c.subject
        for (const key of parseJiraRefs(full)) {
          if (!seen.has(key)) {
            seen.add(key)
            keys.push(key)
          }
        }
      }
      emit(io, opts.json, keys, (k) => k.join('\n'))
    })

  cmd
    .command('list')
    .description('List issues. Defaults to open issues assigned to the authenticated user.')
    .option('--mine', 'Limit to issues assigned to you', false)
    .option('--all', 'Include closed issues', false)
    .option('--limit <n>', 'Max issues to return', (v) => parseInt(v, 10), 50)
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (opts: {
        mine: boolean
        all: boolean
        limit: number
        config: string
        json: boolean
      }) => {
        const provider = adapters.tracker({ configPath: opts.config })
        const issues = await provider.searchIssues({
          openOnly: !opts.all,
          limit: opts.limit,
          ...(opts.mine ? { assignee: 'currentUser' as const } : {}),
        })
        emit(io, opts.json, issues, (list) =>
          table(
            list.map((i) => ({
              key: i.key,
              status: i.status,
              assignee: i.assignee?.displayName ?? '—',
              summary: truncate(i.summary, 60),
            })),
            io.colors,
          ),
        )
      },
    )

  cmd
    .command('show [key]')
    .description('Fetch one issue by key.')
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--json', 'Emit raw JSON', false)
    .action(async (keyArg: string | undefined, opts: { config: string; json: boolean }) => {
      const key = await askOr(io, keyArg, 'Issue key:', 'key')
      const issue = await adapters.tracker({ configPath: opts.config }).getIssue(key)
      emit(
        io,
        opts.json,
        issue,
        (i) =>
          `${io.colors.resource(i.key)}  ${io.colors.bold(i.summary)}\n` +
          `  status:   ${i.status} ${io.colors.hint(`(${i.statusCategory})`)}\n` +
          `  assignee: ${i.assignee?.displayName ?? io.colors.hint('unassigned')}\n` +
          `  updated:  ${io.colors.hint(i.updated)}` +
          (i.url ? `\n  url:      ${io.colors.hint(i.url)}` : ''),
      )
    })

  cmd
    .command('create [summary]')
    .description('Create a new issue in the configured project / repo.')
    .option('-d, --description <text>', 'Plain-text/markdown description body')
    .option('--label <label...>', 'Vendor labels to attach (repeatable)')
    .option(
      '-m, --milestone <ref>',
      'Milestone to attach. Numeric id ("2") or exact title ("v0.1 — Feature parity"). GitHub only — Jira raises an error.',
    )
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        summaryArg: string | undefined,
        opts: {
          description?: string
          label?: string[]
          milestone?: string
          config: string
          json: boolean
        },
      ) => {
        const summary = await askOr(io, summaryArg, 'Issue summary:', 'summary')
        const result = await adapters.tracker({ configPath: opts.config }).createIssue({
          summary,
          description: opts.description,
          labels: opts.label,
          milestone: opts.milestone,
        })
        emit(
          io,
          opts.json,
          result,
          (r) =>
            `${io.colors.success('✓')} created ${io.colors.resource(r.key)} ${io.colors.hint(`(${summary})`)}`,
        )
      },
    )

  cmd
    .command('comment [key] [body...]')
    .description('Add a comment to an issue. Body args are joined with spaces.')
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        keyArg: string | undefined,
        bodyArg: string[] | undefined,
        opts: { config: string; json: boolean },
      ) => {
        const key = await askOr(io, keyArg, 'Issue key:', 'key')
        const joined = (bodyArg ?? []).join(' ').trim()
        const body = joined ? joined : await askOr(io, undefined, 'Comment body:', 'body')
        await adapters.tracker({ configPath: opts.config }).addComment({ key, body })
        emit(
          io,
          opts.json,
          { ok: true, key },
          () =>
            `${io.colors.success('✓')} commented on ${io.colors.resource(key)} ${io.colors.hint(`(${truncate(body, 60)})`)}`,
        )
      },
    )

  cmd
    .command('lifecycle <key> <slot>')
    .description(
      `Move an issue through one of the lifecycle slots (${LIFECYCLE_SLOTS.join(' | ')}). Idempotent — silently no-ops when the issue is already past that state. Optionally posts a comment in the same step.`,
    )
    .option('-m, --message <body>', 'Add a comment alongside the transition')
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        key: string,
        slotArg: string,
        opts: { message?: string; config: string; json: boolean },
      ) => {
        const slot = parseSlot(slotArg)
        const provider = adapters.tracker({ configPath: opts.config })
        // Comment first so it lands even on no-op transitions (the
        // staging-URL comment still wants to be posted).
        if (opts.message) {
          await provider.addComment({ key, body: opts.message })
        }
        const result = await provider.applyLifecycle({ key, slot })
        if (result.transitioned) {
          emit(
            io,
            opts.json,
            { ok: true, key, ...result },
            () =>
              `${io.colors.success('✓')} ${io.colors.resource(key)} → ${io.colors.bold(result.status)} ${result.via ? io.colors.hint(`(${result.via})`) : ''}`,
          )
        } else {
          emit(
            io,
            opts.json,
            { ok: true, key, skipped: true, ...result },
            () =>
              `${io.colors.hint('=')} ${io.colors.resource(key)} already at ${io.colors.bold(result.status)} ${result.via ? io.colors.hint(`(${result.via})`) : ''}`,
          )
        }
      },
    )

  cmd
    .command('backfill')
    .description(
      'Walk git history first-parent and retroactively create one issue per commit, each in Done state with a "backfill" label. Default is --dry-run — pass --apply to actually create.',
    )
    .option('--since <sha>', 'Only backfill commits after this SHA (exclusive)')
    .option('--limit <n>', 'Max commits to process', (v) => parseInt(v, 10))
    .option('--label <label>', 'Vendor label to tag created issues with', 'backfill')
    .option('--apply', 'Actually create the issues (default is dry-run)', false)
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .action(
      async (opts: {
        since?: string
        limit?: number
        label: string
        apply: boolean
        config: string
      }) => {
        const commits = listCommits(
          { since: opts.since, ...(opts.limit ? { limit: opts.limit } : {}) },
          git,
        )
        if (commits.length === 0) {
          io.stdout(io.colors.hint('(no commits to backfill)'))
          return
        }
        const repo = loadRepo(opts.config)
        const planned = commits.map((c) => buildBackfillPlan(c, repo))

        if (!opts.apply) {
          io.stdout(
            io.colors.bold(
              `Would create ${planned.length} issue${planned.length === 1 ? '' : 's'} across ${planned.length} commit${planned.length === 1 ? '' : 's'}:`,
            ),
          )
          io.stdout('')
          for (const p of planned) {
            io.stdout(
              `  ${io.colors.hint(`[${p.commit.sha.slice(0, 7)}]`)} ${truncate(p.summary, 80)}`,
            )
          }
          io.stdout('')
          io.stdout(io.colors.hint('Re-run with --apply to actually create.'))
          return
        }

        const provider = adapters.tracker({ configPath: opts.config })
        let created = 0
        const failures: Array<{ sha: string; error: string }> = []
        for (const p of planned) {
          io.stdout(`${io.colors.hint(`[${p.commit.sha.slice(0, 7)}]`)} ${truncate(p.summary, 80)}`)
          try {
            const { key } = await provider.createIssue({
              summary: p.summary,
              description: p.description,
              labels: [opts.label],
            })
            io.stdout(`  ${io.colors.success('✓')} created ${io.colors.resource(key)}`)
            const result = await provider.applyLifecycle({ key, slot: 'done' })
            if (result.transitioned) {
              io.stdout(`  ${io.colors.success('✓')} transitioned to Done`)
            } else {
              io.stdout(
                `  ${io.colors.hint('=')} ${result.status} (${result.via ?? 'no transition'})`,
              )
            }
            created++
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            io.stdout(`  ${io.colors.error('✗')} ${msg}`)
            failures.push({ sha: p.commit.sha, error: msg })
          }
        }
        io.stdout('')
        io.stdout(
          `${io.colors.success('✓')} backfill complete — ${created}/${planned.length} issue${planned.length === 1 ? '' : 's'} created`,
        )
        if (failures.length > 0) {
          io.stdout(
            io.colors.warn(`(${failures.length} failure${failures.length === 1 ? '' : 's'})`),
          )
        }
      },
    )

  cmd
    .command('doctor')
    .description(
      'Verify tracker credentials, print the configured project / repo + statuses, and show which lifecycle slots are still unmapped.',
    )
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--json', 'Emit raw JSON', false)
    .action(async (opts: { config: string; json: boolean }) => {
      const provider = adapters.tracker({ configPath: opts.config })
      const sp = io.spinner('Verifying tracker credentials…')
      let report
      try {
        report = await provider.doctor()
        sp.succeed(`Authenticated as ${io.colors.resource(report.authedAs)}`)
      } catch (e) {
        sp.fail('Tracker auth failed')
        throw e
      }
      io.stdout(`${io.colors.bold(report.projectLabel)}`)
      io.stdout('')
      io.stdout(io.colors.bold('Statuses:'))
      io.stdout(
        table(
          report.statuses.map((s) => ({ name: s.name, category: s.category })),
          io.colors,
        ),
      )
      io.stdout('')
      io.stdout(io.colors.bold('Lifecycle map:'))
      io.stdout(
        table(
          report.lifecycle.map((l) => ({
            slot: l.slot,
            value: l.value ?? io.colors.warn('(unset)'),
            status: l.resolved ? io.colors.success('✓ resolved') : io.colors.warn('… unset'),
            note: l.note,
          })),
          io.colors,
        ),
      )
      if (opts.json) emit(io, true, report, () => '')
    })

  return cmd
}

// ─── helpers ───────────────────────────────────────────────────────────

function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.slice(0, Math.max(0, maxLen - 1)) + '…'
}

function loadRepo(configPath: string): string | undefined {
  try {
    return loadSetupConfig(configPath).repo
  } catch {
    return undefined
  }
}

interface BackfillPlan {
  commit: GitCommit
  summary: string
  description: string
}

function buildBackfillPlan(commit: GitCommit, repo: string | undefined): BackfillPlan {
  const date = commit.date.slice(0, 10)
  const url = repo ? `https://github.com/${repo}/commit/${commit.sha}` : null
  const descLines = [
    `Backfilled from git commit ${commit.sha.slice(0, 7)} on ${date}.`,
    ...(url ? [url] : []),
  ]
  if (commit.body) descLines.push('', commit.body)
  return {
    commit,
    summary: truncate(commit.subject, 250),
    description: descLines.join('\n'),
  }
}
