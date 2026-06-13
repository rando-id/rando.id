import type { Io } from '../output'

export interface ConfirmOptions {
  /** When true, skip the prompt entirely. */
  yes: boolean
}

/**
 * Ask the user to confirm a destructive action. Returns true if the action
 * should proceed (either `--yes` was passed or the user typed "y"/"yes").
 *
 * Centralizing this in one helper keeps the prompt copy + flag UX identical
 * across every destructive subcommand.
 */
export async function confirmDestructive(
  io: Io,
  options: ConfirmOptions,
  message: string,
): Promise<boolean> {
  if (options.yes) return true
  return io.confirm(`${message} Type "y" to confirm:`)
}
