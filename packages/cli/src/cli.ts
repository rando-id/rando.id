// Top-level CLI entry point. Wires commander, registers subcommand groups,
// and handles errors uniformly (exits non-zero with a stderr message).

import { Command } from 'commander'
import { createAdapters, type Adapters } from './config'
import { defaultIo, type Io } from './output'
import { apiCommand } from './commands/api'
import { clerkCommand } from './commands/clerk'
import { dbCommand } from './commands/db'
import { tunnelCommand } from './commands/tunnel'
import { deployCommand } from './commands/deploy'
import { completionCommand } from './commands/completion'
import { devCommand } from './commands/dev'
import { dnsCommand } from './commands/dns'
import { doctorCommand } from './commands/doctor'
import { infrastructureCommand } from './commands/infrastructure'
import { initCommand } from './commands/init'
import { issuesCommand } from './commands/issues'
import { secretsCommand } from './commands/secrets'
import { setupGhCommand } from './commands/setup-gh'
import { isInteractiveCandidate, pickFromMenu } from './menu'
import { SetupConfigError } from './setup-config'
import { MissingConfigError, NotFoundError, ProviderApiError } from './domain/errors'

export interface RunOptions {
  /** Override adapters (used in tests). Defaults to env-driven factory. */
  adapters?: Adapters
  /** Override stdout/stderr (used in tests). */
  io?: Io
  /** Override `process.exit` (used in tests). */
  exit?: (code: number) => never
}

/**
 * Build the commander program and execute it with the given argv. Returns
 * a promise that resolves once the command (sync or async) finishes.
 */
export async function run(argv: string[], options: RunOptions = {}): Promise<void> {
  const io = options.io ?? defaultIo
  const adapters = options.adapters ?? createAdapters()
  const exit = options.exit ?? ((code: number) => process.exit(code))

  const program = new Command('rando')
    .description('Rando.id infrastructure CLI')
    .exitOverride() // throw instead of process.exit so we control teardown
    .showSuggestionAfterError() // commander prints "did you mean ..." on typos
    .showHelpAfterError() // and shows --help so users see options after errors

  program.addCommand(apiCommand(adapters, io))
  program.addCommand(clerkCommand(adapters, io))
  program.addCommand(dbCommand(adapters, io))
  program.addCommand(tunnelCommand(adapters, io))
  program.addCommand(deployCommand(adapters, io))
  program.addCommand(dnsCommand(adapters, io))
  program.addCommand(infrastructureCommand(adapters, io))
  program.addCommand(issuesCommand(adapters, io))
  program.addCommand(devCommand(io))
  program.addCommand(doctorCommand(adapters, io))
  program.addCommand(initCommand(adapters, io))
  program.addCommand(secretsCommand(adapters, io))
  program.addCommand(setupGhCommand(io))
  program.addCommand(completionCommand(io))

  // Interactive discovery: bare `rando` or `rando <group>` drops the user
  // into a select menu. Skipped in non-TTY contexts (CI, pipes) — those
  // get commander's normal --help output.
  const candidate = isInteractiveCandidate(argv)
  if (candidate && process.stdout.isTTY) {
    try {
      argv = await pickFromMenu(io, candidate.group)
    } catch (e) {
      handleError(e, io, exit)
      return
    }
  }

  try {
    await program.parseAsync(['node', 'rando', ...argv])
  } catch (e) {
    handleError(e, io, exit)
  }
}

function handleError(error: unknown, io: Io, exit: (code: number) => never): void {
  const errLabel = io.colors.error('error:')
  const hintLabel = io.colors.hint('hint:')
  if (error instanceof MissingConfigError) {
    io.stderr(`${errLabel} ${error.message}`)
    io.stderr(
      `${hintLabel} set ${io.colors.bold(error.variable)} in your environment (see .env.example)`,
    )
    exit(2)
  }
  if (error instanceof SetupConfigError) {
    io.stderr(`${errLabel} ${error.message}`)
    io.stderr(
      `${hintLabel} check that rando.config.json exists at the repo root and matches the schema in packages/cli/README.md`,
    )
    exit(2)
  }
  if (error instanceof NotFoundError) {
    io.stderr(`${errLabel} ${error.message}`)
    exit(3)
  }
  if (error instanceof ProviderApiError) {
    io.stderr(`${errLabel} ${io.colors.bold(error.provider)} API ${error.status}`)
    io.stderr(io.colors.hint(error.body))
    exit(4)
  }
  // Commander throws CommanderError for things like --help and invalid args.
  // It already prints its own message; we just translate the exit code.
  if (error && typeof error === 'object' && 'code' in error && 'exitCode' in error) {
    const exitCode = (error as { exitCode: number }).exitCode
    exit(exitCode || 0)
  }
  if (error instanceof Error) {
    io.stderr(`${errLabel} ${error.message}`)
    exit(1)
  }
  io.stderr(`${errLabel} ${String(error)}`)
  exit(1)
}
