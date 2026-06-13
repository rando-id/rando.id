// Top-level CLI entry point. Wires commander, registers subcommand groups,
// and handles errors uniformly (exits non-zero with a stderr message).

import { Command } from 'commander'
import { createAdapters, type Adapters } from './config'
import { defaultIo, type Io } from './output'
import { dbCommand } from './commands/db'
import { tunnelCommand } from './commands/tunnel'
import { deployCommand } from './commands/deploy'
import { dnsCommand } from './commands/dns'
import { infrastructureCommand } from './commands/infrastructure'
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

  const program = new Command('rando').description('Rando.id infrastructure CLI').exitOverride() // throw instead of process.exit so we control teardown

  program.addCommand(dbCommand(adapters, io))
  program.addCommand(tunnelCommand(adapters, io))
  program.addCommand(deployCommand(adapters, io))
  program.addCommand(dnsCommand(adapters, io))
  program.addCommand(infrastructureCommand(adapters, io))

  try {
    await program.parseAsync(['node', 'rando', ...argv])
  } catch (e) {
    handleError(e, io, exit)
  }
}

function handleError(error: unknown, io: Io, exit: (code: number) => never): void {
  if (error instanceof MissingConfigError) {
    io.stderr(`error: ${error.message}`)
    io.stderr(`hint: set ${error.variable} in your environment (see .env.example)`)
    exit(2)
  }
  if (error instanceof SetupConfigError) {
    io.stderr(`error: ${error.message}`)
    io.stderr(
      `hint: check that rando.config.json exists at the repo root and matches the schema in packages/cli/README.md`,
    )
    exit(2)
  }
  if (error instanceof NotFoundError) {
    io.stderr(`error: ${error.message}`)
    exit(3)
  }
  if (error instanceof ProviderApiError) {
    io.stderr(`error: ${error.provider} API ${error.status}`)
    io.stderr(error.body)
    exit(4)
  }
  // Commander throws CommanderError for things like --help and invalid args.
  // It already prints its own message; we just translate the exit code.
  if (error && typeof error === 'object' && 'code' in error && 'exitCode' in error) {
    const exitCode = (error as { exitCode: number }).exitCode
    exit(exitCode || 0)
  }
  if (error instanceof Error) {
    io.stderr(`error: ${error.message}`)
    exit(1)
  }
  io.stderr(`error: ${String(error)}`)
  exit(1)
}
