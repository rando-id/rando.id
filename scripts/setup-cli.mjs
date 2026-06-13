#!/usr/bin/env node
// One-shot setup: symlink `packages/cli/bin/rando.mjs` into a directory on
// the user's PATH so they can run `rando ...` directly (no `pnpm rando`).
// Idempotent — running again just re-points the symlink.

import { existsSync, mkdirSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const binSource = resolve(repoRoot, 'packages/cli/bin/rando.mjs')

if (!existsSync(binSource)) {
  console.error(`error: cannot find ${binSource}`)
  console.error('Run `pnpm install` from the repo root first.')
  process.exit(1)
}

// Prefer the first dir we find on PATH that's user-writable + already exists.
// Fallback: ~/.local/bin (create if missing — common XDG convention).
const pathDirs = (process.env.PATH ?? '').split(':').filter(Boolean)
const preferred = [`${homedir()}/.local/bin`, `${homedir()}/bin`, '/usr/local/bin']
let target = preferred.find((p) => pathDirs.includes(p) && existsSync(p))

if (!target) {
  // Create ~/.local/bin (XDG default) and warn that PATH may need updating.
  target = `${homedir()}/.local/bin`
  mkdirSync(target, { recursive: true })
  if (!pathDirs.includes(target)) {
    console.warn(
      `\n⚠  Created ${target} but it's not on your PATH yet.\n` +
        `   Add this to your shell rc (~/.zshrc, ~/.bashrc, etc.):\n\n` +
        `     export PATH="$HOME/.local/bin:$PATH"\n\n` +
        `   Then start a new shell or \`source ~/.zshrc\`.\n`,
    )
  }
}

const linkPath = `${target}/rando`

// If something is already there, only replace if it's a symlink (don't clobber
// real binaries).
if (existsSync(linkPath)) {
  let stat
  try {
    stat = lstatSync(linkPath)
  } catch {
    stat = null
  }
  if (stat && stat.isSymbolicLink()) {
    const existing = readlinkSync(linkPath)
    if (existing === binSource) {
      console.log(`✓ rando already linked at ${linkPath}`)
      process.exit(0)
    }
    unlinkSync(linkPath)
  } else {
    console.error(`error: ${linkPath} exists and is not a symlink. Move it aside and retry.`)
    process.exit(1)
  }
}

symlinkSync(binSource, linkPath)
console.log(`✓ Linked rando at ${linkPath}`)
console.log(`  Try it:  rando --help`)
