// `rando jira` — Jira ticket-tracker integration.
//
// doctor:     verify auth + lint rando.config.json's lifecycle map
// list:       list issues (filter by assignee/openOnly/project)
// show:       fetch one issue by key
// create:     create a new ticket (summary + optional description)
// transition: move an issue through its workflow
// comment:    post a plain-text comment

import { resolve } from 'node:path'
import { Command } from 'commander'
import type { Adapters } from '../config'
import type { JiraProvider, JiraSearchFilter } from '../domain/jira'
import { MissingConfigError, NotFoundError } from '../domain/errors'
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
import { askOr, pickOr } from './_interactive'

const DEFAULT_CONFIG_PATH = 'rando.config.json'
const LIFECYCLE_KEYS = ['inProgress', 'inReview', 'done'] as const
type LifecycleKey = (typeof LIFECYCLE_KEYS)[number]

export interface JiraCommandDeps {
  /** Injected git runner — tests override to avoid shelling out. */
  git?: GitRunner
}

export function jiraCommand(adapters: Adapters, io: Io, deps: JiraCommandDeps = {}): Command {
  const git = deps.git ?? defaultGitRunner
  const jira = new Command('jira').description('Jira ticket-tracker integration')

  // Lazily read jira.projectKey from rando.config.json so subcommands can
  // default to it without forcing the user to pass --project every time.
  // If config can't be loaded, returns undefined (commands that strictly
  // need it will surface a clear error).
  const defaultProjectKey = (configPath: string): string | undefined => {
    try {
      return loadSetupConfig(resolve(process.cwd(), configPath)).jira?.projectKey
    } catch {
      return undefined
    }
  }

  jira
    .command('pick')
    .description(
      'Pick a Jira ticket for the current branch. Caches the choice in git config so subsequent commits auto-append Refs: <KEY>. Companion to the prepare-commit-msg hook.',
    )
    .option('--project <key>', 'Project key (overrides rando.config.json)')
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
      'Probe mode used by the commit hook. Exits 0 if Jira is fully configured (env + projectKey), 4 otherwise. Does not prompt or modify state.',
      false,
    )
    .action(
      async (opts: {
        project?: string
        limit: number
        config: string
        reset: boolean
        fromHook: boolean
        check: boolean
      }) => {
        // --check is a pure config probe: zero side-effects, no prompts.
        // Exits 0 when Jira is wired (env + projectKey both present);
        // throws otherwise (handleError → exit 1). The hook uses this
        // to decide whether "no cached key" should block the commit.
        if (opts.check) {
          try {
            adapters.jira()
          } catch {
            throw new Error('Jira not configured (missing JIRA_* env vars)')
          }
          const projectKey = opts.project ?? defaultProjectKey(opts.config)
          if (!projectKey) {
            throw new Error('Jira not configured (no jira.projectKey in rando.config.json)')
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

        // Resolve the Jira provider lazily so an unconfigured repo just
        // exits 0 when invoked from the hook instead of blocking commits.
        let provider: JiraProvider
        try {
          provider = adapters.jira()
        } catch (e) {
          if (opts.fromHook && e instanceof MissingConfigError) {
            io.stderr(
              io.colors.hint(
                `(${e.variable} unset — Jira not configured; commit proceeds without Refs: footer)`,
              ),
            )
            return
          }
          throw e
        }

        const projectKey = opts.project ?? defaultProjectKey(opts.config)
        if (!projectKey) {
          if (opts.fromHook) {
            io.stderr(
              io.colors.hint(
                '(no jira.projectKey in rando.config.json — commit proceeds without Refs: footer)',
              ),
            )
            return
          }
          throw new Error(
            'No Jira project key — pass --project, or set jira.projectKey in rando.config.json.',
          )
        }

        const issues = await provider.searchIssues({
          projectKey,
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
              description: i.status.name,
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
              `skipped — commits on ${branch} will not get a Refs: footer (run \`rando jira pick --reset\` to undo)`,
            ),
          )
          return
        }

        let chosenKey = choice
        if (choice === CREATE_NEW) {
          const summary = await askOr(io, undefined, 'New ticket summary:', 'summary')
          const created = await provider.createIssue({ projectKey, summary })
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

  jira
    .command('list')
    .description(
      'List Jira issues. Defaults to open issues assigned to you in the project from rando.config.json.',
    )
    .option('--project <key>', 'Project key (overrides rando.config.json)')
    .option('--mine', 'Limit to issues assigned to the authenticated user', false)
    .option('--all', 'Include closed issues (default lists open only)', false)
    .option('--limit <n>', 'Max issues to return', (v) => parseInt(v, 10), 50)
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (opts: {
        project?: string
        mine: boolean
        all: boolean
        limit: number
        config: string
        json: boolean
      }) => {
        const provider = adapters.jira()
        const filter: JiraSearchFilter = {
          projectKey: opts.project ?? defaultProjectKey(opts.config),
          openOnly: !opts.all,
          limit: opts.limit,
          ...(opts.mine ? { assignee: 'currentUser' as const } : {}),
        }
        const issues = await provider.searchIssues(filter)
        emit(io, opts.json, issues, (list) =>
          table(
            list.map((i) => ({
              key: i.key,
              status: i.status.name,
              assignee: i.assignee?.displayName ?? '—',
              summary: truncate(i.summary, 60),
            })),
            io.colors,
          ),
        )
      },
    )

  jira
    .command('show [key]')
    .description('Fetch one Jira issue by key.')
    .option('--json', 'Emit raw JSON', false)
    .action(async (keyArg: string | undefined, opts: { json: boolean }) => {
      const key = await askOr(io, keyArg, 'Issue key (e.g. RANDO-42):', 'key')
      const issue = await adapters.jira().getIssue(key)
      emit(
        io,
        opts.json,
        issue,
        (i) =>
          `${io.colors.resource(i.key)}  ${io.colors.bold(i.summary)}\n` +
          `  status:   ${i.status.name} ${io.colors.hint(`(${i.status.category})`)}\n` +
          `  assignee: ${i.assignee?.displayName ?? io.colors.hint('unassigned')}\n` +
          `  updated:  ${io.colors.hint(i.updated)}`,
      )
    })

  jira
    .command('create [summary]')
    .description('Create a new Jira issue in the configured project.')
    .option('--project <key>', 'Project key (overrides rando.config.json)')
    .option('-d, --description <text>', 'Plain-text description body')
    .option('-t, --type <name>', 'Issue type name (default Task)')
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        summaryArg: string | undefined,
        opts: {
          project?: string
          description?: string
          type?: string
          config: string
          json: boolean
        },
      ) => {
        const projectKey = opts.project ?? defaultProjectKey(opts.config)
        if (!projectKey) {
          throw new Error(
            'No Jira project key — pass --project, or set jira.projectKey in rando.config.json.',
          )
        }
        const summary = await askOr(io, summaryArg, 'Issue summary:', 'summary')
        const result = await adapters.jira().createIssue({
          projectKey,
          summary,
          description: opts.description,
          issueType: opts.type,
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

  jira
    .command('transition [key] [transition]')
    .description(
      'Move an issue through its workflow. <transition> matches by id or by name (case-insensitive).',
    )
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        keyArg: string | undefined,
        transitionArg: string | undefined,
        opts: { json: boolean },
      ) => {
        const provider = adapters.jira()
        const key = await askOr(io, keyArg, 'Issue key (e.g. RANDO-42):', 'key')
        const transitions = await provider.listTransitions(key)
        const transitionId = await pickOr(
          io,
          transitionArg ? resolveTransitionId(transitionArg, transitions) : undefined,
          () =>
            Promise.resolve(
              transitions.map(
                (t): SelectChoice<string> => ({
                  name: t.name,
                  value: t.id,
                  description: `→ ${t.to.name}`,
                }),
              ),
            ),
          `Transition for ${key}:`,
          'transition',
        )
        const matched = transitions.find((t) => t.id === transitionId)
        if (!matched) {
          throw new NotFoundError('transition', transitionArg ?? transitionId)
        }
        await provider.transitionIssue({ issueKey: key, transitionId: matched.id })
        emit(
          io,
          opts.json,
          { ok: true, key, transition: matched.name, status: matched.to.name },
          () =>
            `${io.colors.success('✓')} ${io.colors.resource(key)} → ${io.colors.bold(matched.to.name)} ${io.colors.hint(`(via "${matched.name}")`)}`,
        )
      },
    )

  jira
    .command('comment [key] [body...]')
    .description('Add a plain-text comment to an issue. Body args are joined with spaces.')
    .option('--json', 'Emit raw JSON', false)
    .action(
      async (
        keyArg: string | undefined,
        bodyArg: string[] | undefined,
        opts: { json: boolean },
      ) => {
        const key = await askOr(io, keyArg, 'Issue key (e.g. RANDO-42):', 'key')
        const joined = (bodyArg ?? []).join(' ').trim()
        const body = joined ? joined : await askOr(io, undefined, 'Comment body:', 'body')
        await adapters.jira().addComment({ issueKey: key, body })
        emit(
          io,
          opts.json,
          { ok: true, key },
          () =>
            `${io.colors.success('✓')} commented on ${io.colors.resource(key)} ${io.colors.hint(`(${truncate(body, 60)})`)}`,
        )
      },
    )

  jira
    .command('refs <range>')
    .description(
      'Extract unique Jira keys from `Refs:` footers in the given git range (e.g. "main..HEAD" or "<base-sha>..<head-sha>"). Used by CI to enumerate tickets touched by a PR.',
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

  jira
    .command('lifecycle <key> <slot>')
    .description(
      'Move a Jira issue through one of the configured lifecycle slots (in-progress | in-review | done) from rando.config.json. Idempotent — silently no-ops when the issue is already past that state. Optionally posts a comment in the same step.',
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
        const slot = slotArg.replace(/-/g, '').toLowerCase()
        if (slot !== 'inprogress' && slot !== 'inreview' && slot !== 'done') {
          throw new Error(
            `Invalid lifecycle slot "${slotArg}". Expected one of: in-progress, in-review, done.`,
          )
        }
        const cfg = loadSetupConfig(resolve(process.cwd(), opts.config))
        const lifecycleMap = cfg.jira?.transitions ?? {}
        const slotKey =
          slot === 'inprogress' ? 'inProgress' : slot === 'inreview' ? 'inReview' : 'done'
        const configuredTransition = lifecycleMap[slotKey]
        if (!configuredTransition) {
          throw new Error(
            `No jira.transitions.${slotKey} in rando.config.json — run \`rando jira doctor\` to see what's available and fill it in.`,
          )
        }

        const provider = adapters.jira()
        // Post the comment first so it lands even when the transition
        // is a no-op (the staging-URL comment still wants to show up).
        if (opts.message) {
          await provider.addComment({ issueKey: key, body: opts.message })
        }

        // Parallel: we need both the current status (to detect the
        // self-loop "already at target" case some default workflows
        // create) and the available transitions.
        const [available, issue] = await Promise.all([
          provider.listTransitions(key),
          provider.getIssue(key),
        ])
        const match = available.find(
          (t) =>
            t.id === configuredTransition ||
            t.name.toLowerCase() === configuredTransition.toLowerCase(),
        )

        // Idempotency: if the configured transition exists but its
        // target status equals the issue's current status, skip — this
        // is the self-loop a basic Jira workflow allows and we don't
        // want a noisy second transition event in the audit log.
        if (match && match.to.name.toLowerCase() === issue.status.name.toLowerCase()) {
          emit(
            io,
            opts.json,
            { ok: true, key, skipped: true, currentStatus: issue.status.name },
            () =>
              `${io.colors.hint('=')} ${io.colors.resource(key)} already at ${io.colors.bold(issue.status.name)} ${io.colors.hint('(no-op)')}`,
          )
          return
        }

        if (!match) {
          // Issue is past the target state (the configured transition
          // isn't available from its current status). Soft no-op so
          // re-fires on PR synchronize don't error.
          emit(
            io,
            opts.json,
            { ok: true, key, skipped: true, currentStatus: issue.status.name },
            () =>
              `${io.colors.hint('=')} ${io.colors.resource(key)} already at ${io.colors.bold(issue.status.name)} ${io.colors.hint(`(transition "${configuredTransition}" not available)`)}`,
          )
          return
        }

        await provider.transitionIssue({ issueKey: key, transitionId: match.id })
        emit(
          io,
          opts.json,
          { ok: true, key, transition: match.name, status: match.to.name },
          () =>
            `${io.colors.success('✓')} ${io.colors.resource(key)} → ${io.colors.bold(match.to.name)} ${io.colors.hint(`(via "${match.name}")`)}`,
        )
      },
    )

  jira
    .command('backfill')
    .description(
      'Walk git history first-parent and retroactively create one Jira ticket per commit, each in Done state with a "backfill" label. Default is --dry-run — pass --apply to actually create.',
    )
    .option('--since <sha>', 'Only backfill commits after this SHA (exclusive)')
    .option('--limit <n>', 'Max commits to process', (v) => parseInt(v, 10))
    .option('--project <key>', 'Project key (overrides rando.config.json)')
    .option('--label <label>', 'Jira label to tag created tickets with', 'backfill')
    .option('--apply', 'Actually create the tickets (default is dry-run)', false)
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .action(
      async (opts: {
        since?: string
        limit?: number
        project?: string
        label: string
        apply: boolean
        config: string
      }) => {
        const provider = adapters.jira()
        const projectKey = opts.project ?? defaultProjectKey(opts.config)
        if (!projectKey) {
          throw new Error(
            'No Jira project key — pass --project, or set jira.projectKey in rando.config.json.',
          )
        }

        const commits = listCommits(
          { since: opts.since, ...(opts.limit ? { limit: opts.limit } : {}) },
          git,
        )
        if (commits.length === 0) {
          io.stdout(io.colors.hint('(no commits to backfill)'))
          return
        }

        const repo = loadRepo(opts.config)
        const planned = commits.map((c) => buildBackfillPlan(c, repo, opts.label))

        if (!opts.apply) {
          io.stdout(
            io.colors.bold(
              `Would create ${planned.length} ticket${planned.length === 1 ? '' : 's'} across ${planned.length} commit${planned.length === 1 ? '' : 's'}:`,
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

        // --apply: create + transition each in turn. Sequential (not
        // parallel) so the API rate-limit headroom stays comfortable and
        // so output order matches git order — easier to eyeball.
        let created = 0
        const failures: Array<{ sha: string; error: string }> = []
        for (const p of planned) {
          io.stdout(`${io.colors.hint(`[${p.commit.sha.slice(0, 7)}]`)} ${truncate(p.summary, 80)}`)
          try {
            const { key } = await provider.createIssue({
              projectKey,
              summary: p.summary,
              description: p.description,
              labels: [opts.label],
            })
            io.stdout(`  ${io.colors.success('✓')} created ${io.colors.resource(key)}`)

            // Transition straight to Done. From the To Do start state the
            // user's workflow allows a direct Done transition; if a
            // project requires intermediate steps, the resolveTransitionId
            // helper will return undefined and we'll log a warning rather
            // than fail the whole batch.
            const available = await provider.listTransitions(key)
            const doneId = pickDoneTransition(available)
            if (!doneId) {
              io.stdout(
                `  ${io.colors.warn('⚠')} no direct Done transition available — left in initial state`,
              )
            } else {
              await provider.transitionIssue({ issueKey: key, transitionId: doneId })
              io.stdout(`  ${io.colors.success('✓')} transitioned to Done`)
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
          `${io.colors.success('✓')} backfill complete — ${created}/${planned.length} ticket${planned.length === 1 ? '' : 's'} created`,
        )
        if (failures.length > 0) {
          io.stdout(
            io.colors.warn(`(${failures.length} failure${failures.length === 1 ? '' : 's'})`),
          )
        }
      },
    )

  jira
    .command('doctor')
    .description(
      'Verify Jira credentials, print project + available transitions, and show which lifecycle slots are still unmapped in rando.config.json.',
    )
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option('--issue <key>', 'Issue key to probe for available transitions (e.g. RANDO-1)')
    .option('--json', 'Emit raw JSON', false)
    .action(async (opts: { config: string; issue?: string; json: boolean }) => {
      const provider = adapters.jira()
      const { colors } = io

      // 1. Auth check
      const sp = io.spinner('Verifying Jira credentials…')
      let me
      try {
        me = await provider.getMyself()
        sp.succeed(
          `Authenticated as ${colors.resource(me.displayName)} ${colors.hint(`(${me.emailAddress ?? me.accountId})`)}`,
        )
      } catch (e) {
        sp.fail('Jira auth failed')
        throw e
      }

      // 2. Find the configured project. Config is optional — we degrade
      //    to a "no project configured" mode so the user can run doctor
      //    before they've filled in rando.config.json.
      const configPath = resolve(process.cwd(), opts.config)
      let projectKey: string | undefined
      let configuredTransitions: Partial<Record<LifecycleKey, string>> = {}
      try {
        const cfg = loadSetupConfig(configPath)
        projectKey = cfg.jira?.projectKey
        configuredTransitions = cfg.jira?.transitions ?? {}
      } catch {
        io.stderr(
          colors.hint(
            `(skipping rando.config.json — couldn't load ${configPath}; doctor will run with no project filter)`,
          ),
        )
      }

      if (!projectKey) {
        io.stdout(
          colors.warn(
            'No jira.projectKey in rando.config.json — set it to enable lifecycle automation.',
          ),
        )
        if (opts.json) emit(io, true, { user: me, project: null, transitions: null }, () => '')
        return
      }

      // 3. Project summary + statuses
      const project = await provider.getProject(projectKey)
      io.stdout(
        `${colors.bold('Project:')} ${colors.resource(project.key)} ${colors.hint(`(${project.name})`)}`,
      )

      const statuses = await provider.listStatuses(projectKey)
      io.stdout('')
      io.stdout(colors.bold('Statuses (across all issue types):'))
      io.stdout(
        table(
          statuses.map((s) => ({
            id: s.id,
            name: s.name,
            category: s.category,
          })),
          colors,
        ),
      )

      // 4. Transitions for one issue. Jira returns *available* transitions
      //    per-issue (depends on current status), so we need a sample
      //    issue. Caller can pass --issue; otherwise we grab the most
      //    recent open one in the project.
      let sampleKey = opts.issue
      if (!sampleKey) {
        const recent = await provider.searchIssues({
          projectKey,
          openOnly: true,
          limit: 1,
        })
        sampleKey = recent[0]?.key
      }

      let transitions: Awaited<ReturnType<typeof provider.listTransitions>> = []
      if (sampleKey) {
        io.stdout('')
        io.stdout(
          colors.bold(`Transitions available from ${colors.resource(sampleKey)}'s current status:`),
        )
        transitions = await provider.listTransitions(sampleKey)
        io.stdout(
          table(
            transitions.map((t) => ({
              id: t.id,
              name: t.name,
              'leads to': t.to.name,
            })),
            colors,
          ),
        )
        io.stdout(
          colors.hint(
            '(transitions are issue-state-dependent; create one issue per workflow status to see the full set)',
          ),
        )
      } else {
        io.stdout('')
        io.stdout(
          colors.hint(
            'No open issues in the project yet — create one and re-run `rando jira doctor --issue <KEY>` to see transitions.',
          ),
        )
      }

      // 5. Lifecycle map check
      io.stdout('')
      io.stdout(colors.bold('rando.config.json lifecycle map:'))
      const rows = LIFECYCLE_KEYS.map((k) => {
        const value = configuredTransitions[k]
        const ok = value != null
        const resolvedHint = resolveLifecycleHint(value, transitions, statuses)
        return {
          slot: k,
          value: value ?? colors.warn('(unset)'),
          status: ok ? colors.success('✓ mapped') : colors.warn('… unset'),
          note: resolvedHint,
        }
      })
      io.stdout(table(rows, colors))

      if (opts.json) {
        emit(
          io,
          true,
          { user: me, project, statuses, transitions, lifecycle: configuredTransitions },
          () => '',
        )
      }
    })

  return jira
}

/**
 * Resolve a user-supplied transition (id OR case-insensitive name) to a
 * concrete transition id from the issue's available list. Returns
 * undefined if nothing matches — callers throw NotFoundError so the
 * stderr surface is consistent with other commands.
 */
function resolveTransitionId(
  given: string,
  transitions: Awaited<ReturnType<JiraProvider['listTransitions']>>,
): string | undefined {
  const byId = transitions.find((t) => t.id === given)
  if (byId) return byId.id
  const byName = transitions.find((t) => t.name.toLowerCase() === given.toLowerCase())
  return byName?.id
}

/** Truncate to maxLen with a trailing ellipsis. Pure. */
function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.slice(0, Math.max(0, maxLen - 1)) + '…'
}

/**
 * Read the `repo` field from rando.config.json (e.g. "rando-id/rando").
 * Used to build commit URLs in backfill ticket descriptions. Returns
 * undefined if config can't be loaded or `repo` is absent.
 */
function loadRepo(configPath: string): string | undefined {
  try {
    return loadSetupConfig(resolve(process.cwd(), configPath)).repo
  } catch {
    return undefined
  }
}

interface BackfillPlan {
  commit: GitCommit
  summary: string
  description: string
}

/**
 * Build the create-issue params for one git commit. The description
 * includes a `Backfilled from commit <sha>` line so the source is
 * obvious in the Jira UI, plus a commit URL when the repo is known.
 */
function buildBackfillPlan(
  commit: GitCommit,
  repo: string | undefined,
  _label: string,
): BackfillPlan {
  const date = commit.date.slice(0, 10) // YYYY-MM-DD
  const url = repo ? `https://github.com/${repo}/commit/${commit.sha}` : null
  const descLines = [
    `Backfilled from git commit ${commit.sha.slice(0, 7)} on ${date}.`,
    ...(url ? [url] : []),
  ]
  if (commit.body) {
    descLines.push('', commit.body)
  }
  return {
    commit,
    // Jira summary has a 255-char limit; clamp defensively even though
    // most commit subjects are well under.
    summary: truncate(commit.subject, 250),
    description: descLines.join('\n'),
  }
}

/**
 * Pick a transition that lands the issue in a Done-category status.
 * Returns the id, or undefined when no direct Done transition exists.
 */
function pickDoneTransition(
  transitions: Awaited<ReturnType<JiraProvider['listTransitions']>>,
): string | undefined {
  return transitions.find((t) => t.to.category === 'done')?.id
}

/**
 * Given a configured transition value (name OR id) and the project's
 * statuses + transitions, return a short note describing what the value
 * resolves to — or a warning that nothing matches it.
 */
function resolveLifecycleHint(
  value: string | undefined,
  transitions: Array<{ id: string; name: string; to: { name: string } }>,
  statuses: Array<{ id: string; name: string }>,
): string {
  if (!value) return ''
  const byId = transitions.find((t) => t.id === value)
  if (byId) return `→ "${byId.name}" → ${byId.to.name}`
  const byName = transitions.find((t) => t.name.toLowerCase() === value.toLowerCase())
  if (byName) return `→ ${byName.to.name} (transition id ${byName.id})`
  const statusMatch = statuses.find((s) => s.name.toLowerCase() === value.toLowerCase())
  if (statusMatch) return `status name only — no transition matches; check spelling`
  return `(no match in available transitions)`
}
