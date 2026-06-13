// Per-arg interactive prompting helpers. Each "destination" command can
// declare its positionals as optional in commander and delegate the
// "missing? prompt or fail loudly" decision to these helpers.
//
// Pattern at the call site:
//   const projectId = await pickOr(io, rawProjectId, listProjects, 'Pick a project', 'projectId')
//   const name = await askOr(io, rawName, 'New project name?')

import type { Io, SelectChoice } from '../output'

/**
 * Either return the given value, or prompt the user to select from a
 * provider-loaded list. Non-TTY contexts throw a clear error pointing at
 * the missing argument so scripted use stays explicit.
 */
export async function pickOr<T>(
  io: Io,
  given: T | undefined,
  loader: () => Promise<SelectChoice<T>[]>,
  message: string,
  argName: string,
): Promise<T> {
  if (given !== undefined && given !== '') return given
  if (!process.stdout.isTTY) {
    throw new Error(
      `Missing required argument <${argName}>. Pass it on the command line, or run \`rando\` in an interactive terminal.`,
    )
  }
  const choices = await loader()
  if (choices.length === 0) {
    throw new Error(
      `${message} — nothing to pick from. Create one first or pass <${argName}> explicitly.`,
    )
  }
  return io.select(message, choices)
}

/**
 * Either return the given value, or prompt for free-text input. Default
 * is shown as a placeholder. Non-TTY contexts throw a clear error.
 */
export async function askOr(
  io: Io,
  given: string | undefined,
  message: string,
  argName: string,
  defaultValue?: string,
): Promise<string> {
  if (given !== undefined && given !== '') return given
  if (!process.stdout.isTTY) {
    throw new Error(
      `Missing required argument <${argName}>. Pass it on the command line, or run \`rando\` in an interactive terminal.`,
    )
  }
  return io.input(message, { default: defaultValue })
}
