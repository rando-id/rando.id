// Shared shape for every `rando doctor` check. Each check is a small
// async function that returns a CheckResult — the runner orchestrates
// + renders a table, and `rando init` reuses the same results to
// decide what to prompt for.

export type CheckStatus = 'ok' | 'warn' | 'fail'

export interface CheckResult {
  /** Status flag used for table rendering + exit code. */
  status: CheckStatus
  /** Short subject line (e.g. "GITHUB_TOKEN set + valid"). */
  subject: string
  /** Optional one-line hint shown on warn/fail. */
  hint?: string
  /**
   * Optional remediation tag — `init` looks at this to decide which
   * interactive prompt to run when fixing the failure. Examples:
   * 'env:GITHUB_TOKEN', 'config:missing', 'hooks:not-installed'.
   */
  fix?: string
}

export interface Check {
  /** Section label shown in the table (e.g. "Env", "Config", "Hooks"). */
  section: string
  /** Per-check label (e.g. "GITHUB_TOKEN", "rando.config.json"). */
  name: string
  /** Awaitable runner that returns a CheckResult. */
  run(): Promise<CheckResult>
}

export interface DoctorReport {
  results: Array<{ check: Check; result: CheckResult }>
  /** True when every check is `ok`. */
  ok: boolean
  /** True when at least one check is `fail` (warn doesn't count). */
  hasFailures: boolean
}
