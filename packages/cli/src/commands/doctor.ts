// `rando doctor` — broad health check across every surface the CLI
// touches: env vars (presence + validity via vendor API), rando.config
// .json, husky hooks, local PATH (Node version, rando symlink, gh,
// pg_dump, docker), tracker auth + lifecycle map, terminal rendering.
//
// Each check is a small async fn returning a structured CheckResult;
// the orchestrator runs them in parallel and renders a table. Exit
// non-zero on any failure so CI / scripts can gate on it.

import { Command } from 'commander'
import type { Adapters } from '../config'
import type { Io } from '../output'
import { brewChecks } from '../doctor/checks/brew'
import { envChecks } from '../doctor/checks/env'
import { configChecks } from '../doctor/checks/config'
import { hooksChecks } from '../doctor/checks/hooks'
import { localChecks } from '../doctor/checks/local'
import { secretsChecks } from '../doctor/checks/secrets'
import { trackerChecks } from '../doctor/checks/tracker'
import { terminalChecks } from '../doctor/checks/terminal'
import { renderReport, runChecks } from '../doctor/run'

const DEFAULT_CONFIG_PATH = 'rando.config.json'

export function doctorCommand(adapters: Adapters, io: Io): Command {
  return new Command('doctor')
    .description(
      'Run every health check the CLI knows about — env, config, hooks, local PATH, tracker, terminal. Exits non-zero on any failure.',
    )
    .option('--config <path>', 'Path to rando.config.json', DEFAULT_CONFIG_PATH)
    .option(
      '--skip-tracker',
      'Skip the tracker probe (useful in CI when no tracker is configured)',
      false,
    )
    .action(async (opts: { config: string; skipTracker: boolean }) => {
      const checks = [
        ...envChecks(adapters),
        ...configChecks(opts.config),
        ...hooksChecks(),
        ...localChecks(),
        ...brewChecks(),
        ...(opts.skipTracker ? [] : trackerChecks(adapters, opts.config)),
        ...secretsChecks(adapters, opts.config),
        ...terminalChecks(),
      ]
      // Spinner while the checks run — without it the terminal sits
      // silent through op biometric prompts, brew bundle check, and
      // the tracker API round-trip. ora auto-disables in non-TTY
      // contexts so CI logs aren't polluted with control sequences.
      const sp = io.spinner(`Running ${checks.length} checks…`)
      let report
      try {
        report = await runChecks(checks)
      } catch (e) {
        sp.fail('Doctor run failed')
        throw e
      }
      sp.stop()
      renderReport(io, report)
      if (report.hasFailures) {
        process.exitCode = 1
      }
    })
}
