// `rando completion <shell>` — emits a shell completion script the user can
// source. Static surface is fine: the command tree doesn't change at
// runtime, and adding real dynamic completion (which would require
// re-invoking `rando` per keystroke) is more complexity than it's worth.

import { Command } from 'commander'
import type { Io } from '../output'

const TOP_LEVEL = [
  'db',
  'tunnel',
  'deploy',
  'dns',
  'infra',
  'infrastructure',
  'dev',
  'doctor',
  'completion',
  'help',
] as const

/** subcommand structure for each top-level group, indexed by name. */
const SUBCOMMANDS: Record<string, string[]> = {
  db: ['project', 'branch', 'connection-string', 'extension-enable', 'sync'],
  'db project': ['create', 'list', 'delete'],
  'db branch': ['create', 'list', 'delete'],
  tunnel: ['create', 'list', 'delete', 'token', 'route'],
  'tunnel route': ['add', 'list', 'remove'],
  deploy: ['app', 'env', 'domain', 'branch', 'teardown', 'promote'],
  'deploy app': ['create', 'list', 'delete'],
  'deploy env': ['set', 'list'],
  'deploy domain': ['add', 'remove'],
  dns: ['record'],
  'dns record': ['add', 'list', 'remove'],
  infra: ['setup', 'destroy'],
  infrastructure: ['setup', 'destroy'],
  completion: ['bash', 'zsh', 'fish'],
}

export function completionCommand(io: Io): Command {
  return new Command('completion')
    .description(
      'Print a shell completion script (bash, zsh, or fish) — source it in your shell rc',
    )
    .argument('<shell>', 'Shell: bash, zsh, or fish')
    .action((shell: string) => {
      if (shell === 'bash') io.stdout(bashScript())
      else if (shell === 'zsh') io.stdout(zshScript())
      else if (shell === 'fish') io.stdout(fishScript())
      else throw new Error(`Unsupported shell "${shell}". Must be one of: bash, zsh, fish.`)
    })
}

function bashScript(): string {
  // Two-deep completion: top-level + immediate subcommand. Deeper subs
  // (e.g. `rando db project create`) are unhandled by completion but
  // still work — the user just doesn't get tab there. Acceptable tradeoff.
  const cases = Object.entries(SUBCOMMANDS)
    .map(([path, subs]) => {
      const parts = path.split(' ')
      const matchLast = parts[parts.length - 1]
      return `      ${matchLast})
        COMPREPLY=( $(compgen -W "${subs.join(' ')}" -- "$cur") )
        return 0
        ;;`
    })
    .join('\n')

  return `_rando_completion() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${TOP_LEVEL.join(' ')}" -- "$cur") )
    return 0
  fi

  case "$prev" in
${cases}
  esac
}
complete -F _rando_completion rando
`
}

function zshScript(): string {
  const subBlocks = Object.entries(SUBCOMMANDS)
    .map(([path, subs]) => {
      const parts = path.split(' ')
      const matchLast = parts[parts.length - 1]
      return `      ${matchLast})
        _values 'subcommand' ${subs.map((s) => `'${s}'`).join(' ')}
        ;;`
    })
    .join('\n')

  return `#compdef rando

_rando() {
  local context state line
  if (( CURRENT == 2 )); then
    _values 'command' ${TOP_LEVEL.map((c) => `'${c}'`).join(' ')}
    return
  fi
  case "$words[CURRENT-1]" in
${subBlocks}
  esac
}

compdef _rando rando
`
}

function fishScript(): string {
  // Fish completion: one `complete` line per top-level command and per
  // subcommand path. fish handles nesting via `__fish_seen_subcommand_from`.
  const top = TOP_LEVEL.map((c) => `complete -c rando -n "__fish_use_subcommand" -a "${c}"`).join(
    '\n',
  )
  const subs = Object.entries(SUBCOMMANDS)
    .map(([path, subs]) => {
      const parts = path.split(' ')
      const guard = parts.map((p) => p).join(' ')
      return subs
        .map((s) => `complete -c rando -n "__fish_seen_subcommand_from ${guard}" -a "${s}"`)
        .join('\n')
    })
    .join('\n')
  return `${top}\n${subs}\n`
}
