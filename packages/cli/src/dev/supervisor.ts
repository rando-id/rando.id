// Lightweight process supervisor for `rando dev`. Spawns one or more
// long-running children, multiplexes their stdout/stderr through colored
// line prefixes, and propagates SIGINT/SIGTERM down to the whole tree so
// Ctrl+C tears everything down cleanly.
//
// The `Spawner` interface is injected so tests can drive the supervisor
// with fake processes — no real `child_process.spawn` calls in unit tests.

import { spawn as nodeSpawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { Io, IoColors } from '../output'
import { assignColors, makeLineBuffer, type ColorKey } from './log-mux'

export interface ChildSpec {
  /** Display name used as the log prefix. */
  name: string
  /** Executable to run. */
  command: string
  /** Argv passed to `command`. */
  args: string[]
  /** Working directory; defaults to current cwd. */
  cwd?: string
  /** Env overrides; merged onto process.env. */
  env?: Record<string, string>
}

/**
 * Minimal subset of `ChildProcess` the supervisor relies on — kept narrow
 * so tests can implement it without dragging in the full Node API.
 */
export interface SupervisedProcess {
  pid?: number
  stdout: Readable | null
  stderr: Readable | null
  kill(signal?: NodeJS.Signals): boolean
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
}

export type Spawner = (spec: ChildSpec) => SupervisedProcess

export const defaultSpawner: Spawner = (spec) =>
  nodeSpawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...(spec.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as unknown as SupervisedProcess

/** Result of running the supervisor — caller exits with this code. */
export interface SupervisorExit {
  code: number
  /** Map of child name → its exit code (null if killed by signal). */
  exits: Record<string, number | null>
}

/**
 * Spawn every child, wire up log multiplexing, and resolve once every
 * child has exited (or the first one exits and we tear the rest down).
 * Returns the overall exit code: 0 only if every child exited cleanly.
 */
export async function runSupervisor(
  io: Io,
  children: ChildSpec[],
  options: { spawner?: Spawner } = {},
): Promise<SupervisorExit> {
  const spawner = options.spawner ?? defaultSpawner
  const colors = io.colors
  const prefixWidth = Math.max(...children.map((c) => c.name.length))
  const colorMap = assignColors(children.map((c) => c.name))

  const procs: Array<{ spec: ChildSpec; child: SupervisedProcess }> = []
  const exits: Record<string, number | null> = {}
  let tearingDown = false

  const teardown = () => {
    if (tearingDown) return
    tearingDown = true
    for (const { child, spec } of procs) {
      if (!(spec.name in exits)) {
        try {
          child.kill('SIGTERM')
        } catch {
          // child may already be gone — ignore
        }
      }
    }
  }

  const sigintHandler = () => {
    io.stdout(colors.hint('\n^C — shutting down…'))
    teardown()
  }
  const sigtermHandler = () => teardown()
  process.on('SIGINT', sigintHandler)
  process.on('SIGTERM', sigtermHandler)

  try {
    for (const spec of children) {
      const child = spawner(spec)
      procs.push({ spec, child })
      wireLogStream(child.stdout, spec.name, colors, colorMap, prefixWidth, io)
      wireLogStream(child.stderr, spec.name, colors, colorMap, prefixWidth, io)
      io.stdout(
        `${colors.hint(`[${spec.name.padEnd(prefixWidth)}]`)} ${colors.hint(`spawned (pid ${child.pid ?? '?'})`)}`,
      )
    }

    await Promise.all(
      procs.map(
        ({ spec, child }) =>
          new Promise<void>((resolve) => {
            child.on('exit', (code, signal) => {
              exits[spec.name] = code
              const summary = signal
                ? colors.warn(`exited (${signal})`)
                : code === 0
                  ? colors.success('exited (0)')
                  : colors.error(`exited (${code})`)
              io.stdout(`${colors.hint(`[${spec.name.padEnd(prefixWidth)}]`)} ${summary}`)
              // First unexpected exit triggers teardown of the rest so we
              // don't leave orphaned processes running.
              if (!tearingDown && code !== 0) teardown()
              resolve()
            })
          }),
      ),
    )
  } finally {
    process.off('SIGINT', sigintHandler)
    process.off('SIGTERM', sigtermHandler)
  }

  const anyFailed = Object.values(exits).some((c) => c !== 0)
  return { code: anyFailed ? 1 : 0, exits }
}

function wireLogStream(
  stream: Readable | null,
  name: string,
  colors: IoColors,
  colorMap: Map<string, ColorKey>,
  prefixWidth: number,
  io: Io,
): void {
  if (!stream) return
  const colorKey = colorMap.get(name) ?? 'hint'
  const buffer = makeLineBuffer(name, colors, colorKey, prefixWidth, (line) => io.stdout(line))
  stream.on('data', (chunk: Buffer) => buffer.write(chunk))
  stream.on('end', () => buffer.flush())
}
