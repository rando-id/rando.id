// Output helpers. All commands route through `Io` so output is consistent
// and easy to mock in tests. This is the chokepoint for stdout/stderr,
// confirmation prompts, colors, spinners, and interactive selects.

import chalk from 'chalk'
import { confirm as inqConfirm, input as inqInput, select as inqSelect } from '@inquirer/prompts'
import ora, { type Ora } from 'ora'

/** Semantic color palette. Render functions only — pure (text -> text). */
export interface IoColors {
  /** Successful operation / created resource. */
  success(text: string): string
  /** Hard failure / fatal error. */
  error(text: string): string
  /** Warnings, skips, "already exists" outcomes. */
  warn(text: string): string
  /** Quiet hint / supplemental info, e.g. "see also ..." */
  hint(text: string): string
  /** Bold emphasis without semantic color. */
  bold(text: string): string
  /** Resource name highlight (project, branch, hostname). */
  resource(text: string): string
}

/**
 * Handle for a live spinner. Calling `succeed`/`fail`/`info`/`warn` resolves
 * the spinner with the matching symbol; `stop` clears without a symbol.
 */
export interface IoSpinner {
  succeed(text?: string): void
  fail(text?: string): void
  info(text?: string): void
  warn(text?: string): void
  stop(): void
  setText(text: string): void
}

export interface SelectChoice<T = string> {
  name: string
  value: T
  description?: string
}

export interface Io {
  stdout: (line: string) => void
  stderr: (line: string) => void
  /** Confirmation prompt — true on `y`/`yes`/Enter-with-default. */
  confirm: (message: string) => Promise<boolean>
  /** Semantic color helpers. Identity functions when color is disabled. */
  colors: IoColors
  /** Open a spinner. Returns a handle that callers resolve with succeed/fail/etc. */
  spinner: (text: string) => IoSpinner
  /** Interactive single-select. Throws if invoked in a non-TTY context. */
  select: <T>(message: string, choices: SelectChoice<T>[]) => Promise<T>
  /** Free-text input. Throws if invoked in a non-TTY context. */
  input: (message: string, options?: { default?: string }) => Promise<string>
}

// --- color setup ----------------------------------------------------------

/**
 * Decide whether to render colors + spinners. chalk and ora both auto-detect
 * `process.stdout.isTTY`, but pnpm/npm script invocations occasionally end up
 * with `isTTY === undefined` even when the user is sitting at a real
 * terminal. We add a second signal: if we're running inside an
 * npm/pnpm/yarn script (`npm_lifecycle_event` is set) and we have a sensible
 * `TERM` and we're not in CI, force-enable.
 *
 * `NO_COLOR` always wins. `FORCE_COLOR` already wins through chalk.
 */
function detectInteractive(): boolean {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return true
  if (process.stdout.isTTY) return true
  const inScriptLifecycle = Boolean(process.env.npm_lifecycle_event)
  const term = process.env.TERM
  const hasUsableTerm = Boolean(term) && term !== 'dumb'
  const inCi = Boolean(process.env.CI)
  return inScriptLifecycle && hasUsableTerm && !inCi
}

const interactive = detectInteractive()

// chalk's auto-detection may have set level=0 if it saw isTTY undefined.
// Bump it back up if our smarter check decided we're interactive.
if (interactive && chalk.level === 0) chalk.level = 1
if (!interactive) chalk.level = 0

const realColors: IoColors = {
  success: (s) => chalk.green(s),
  error: (s) => chalk.red(s),
  warn: (s) => chalk.yellow(s),
  hint: (s) => chalk.dim(s),
  bold: (s) => chalk.bold(s),
  resource: (s) => chalk.cyan.bold(s),
}

// --- spinner setup --------------------------------------------------------

/**
 * Wrap an `ora` instance behind the `IoSpinner` interface. ora's own TTY
 * detection has the same blind spot as chalk's, so we pass `isEnabled`
 * explicitly based on our interactive heuristic.
 */
function makeSpinner(text: string): IoSpinner {
  const o: Ora = ora({ text, color: 'cyan', isEnabled: interactive }).start()
  return {
    succeed: (t) => {
      o.succeed(t)
    },
    fail: (t) => {
      o.fail(t)
    },
    info: (t) => {
      o.info(t)
    },
    warn: (t) => {
      o.warn(t)
    },
    stop: () => {
      o.stop()
    },
    setText: (t) => {
      o.text = t
    },
  }
}

// --- defaultIo ------------------------------------------------------------

export const defaultIo: Io = {
  stdout: (line) => process.stdout.write(line + '\n'),
  stderr: (line) => process.stderr.write(line + '\n'),
  confirm: async (message) => {
    return await inqConfirm({ message, default: false })
  },
  colors: realColors,
  spinner: makeSpinner,
  select: async (message, choices) => {
    return await inqSelect({
      message,
      choices: choices.map((c) => ({
        name: c.name,
        value: c.value,
        description: c.description,
      })),
    })
  },
  input: async (message, options) => {
    return await inqInput({ message, default: options?.default })
  },
}

// --- rendering helpers ----------------------------------------------------

/** Print either JSON (when `--json`) or a human-readable rendering. */
export function emit<T>(io: Io, json: boolean, value: T, render: (v: T) => string): void {
  if (json) {
    io.stdout(JSON.stringify(value, null, 2))
  } else {
    io.stdout(render(value))
  }
}

export function table(rows: Array<Record<string, string>>, colors?: IoColors): string {
  if (rows.length === 0) return colors ? colors.hint('(no results)') : '(no results)'
  const keys = Object.keys(rows[0] ?? {})
  const widths: Record<string, number> = {}
  for (const key of keys) {
    widths[key] = Math.max(key.length, ...rows.map((r) => (r[key] ?? '').toString().length))
  }
  const header = keys.map((k) => k.padEnd(widths[k] ?? 0)).join('  ')
  const sep = keys.map((k) => '-'.repeat(widths[k] ?? 0)).join('  ')
  const body = rows
    .map((r) => keys.map((k) => (r[k] ?? '').toString().padEnd(widths[k] ?? 0)).join('  '))
    .join('\n')
  if (colors) {
    // Header in resource color (cyan + bold) so it's obviously distinct from
    // the data rows — bold-only is too subtle on most themes.
    return `${colors.resource(header)}\n${colors.hint(sep)}\n${body}`
  }
  return `${header}\n${sep}\n${body}`
}
