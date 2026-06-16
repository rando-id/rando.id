#!/usr/bin/env node
// Bootstrap wrapper. Locates the repo root + tsx + .env via the script's own
// path, then re-execs node with absolute paths so `rando` works from any
// directory (not just the repo root). The CWD relativeness in `--import` and
// `--env-file-if-exists` would otherwise break invocation from elsewhere.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const tsxEsm = resolve(repoRoot, 'node_modules/tsx/dist/esm/index.mjs')
const envFile = resolve(repoRoot, '.env')
const entry = resolve(here, '_run.mjs')
const workspaceBin = resolve(repoRoot, 'node_modules/.bin')

if (!existsSync(tsxEsm)) {
  process.stderr.write(
    `rando: cannot find tsx at ${tsxEsm}. Run \`pnpm install\` in the repo root.\n`,
  )
  process.exit(1)
}

// Prepend the workspace's `node_modules/.bin` to PATH so adapters that
// shell out to workspace-pinned CLIs (vercel, postman, etc.) resolve
// to the version we depend on, regardless of where `rando` was invoked
// from. Global installs still win if the workspace doesn't ship the
// binary — the prepend is additive.
const childPath =
  process.env.PATH && process.env.PATH.length > 0
    ? `${workspaceBin}${delimiter}${process.env.PATH}`
    : workspaceBin

const child = spawn(
  process.execPath,
  [
    `--env-file-if-exists=${envFile}`,
    `--import=${pathToFileURL(tsxEsm).href}`,
    entry,
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: { ...process.env, PATH: childPath } },
)

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
