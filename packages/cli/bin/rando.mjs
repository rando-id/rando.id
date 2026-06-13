#!/usr/bin/env node
// Bootstrap wrapper. Locates the repo root + tsx + .env via the script's own
// path, then re-execs node with absolute paths so `rando` works from any
// directory (not just the repo root). The CWD relativeness in `--import` and
// `--env-file-if-exists` would otherwise break invocation from elsewhere.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const tsxEsm = resolve(repoRoot, 'node_modules/tsx/dist/esm/index.mjs')
const envFile = resolve(repoRoot, '.env')
const entry = resolve(here, '_run.mjs')

if (!existsSync(tsxEsm)) {
  process.stderr.write(
    `rando: cannot find tsx at ${tsxEsm}. Run \`pnpm install\` in the repo root.\n`,
  )
  process.exit(1)
}

const child = spawn(
  process.execPath,
  [
    `--env-file-if-exists=${envFile}`,
    `--import=${pathToFileURL(tsxEsm).href}`,
    entry,
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
)

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
