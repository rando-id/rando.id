// `rando doctor` — environment + rendering diagnostic. Use this when colors
// or spinners aren't visible in your terminal to figure out which layer is
// failing (env detection, chalk level, or the terminal's own rendering).

import { Command } from 'commander'
import chalk from 'chalk'
import type { Io } from '../output'

export function doctorCommand(io: Io): Command {
  return new Command('doctor')
    .description('Diagnose terminal color + spinner support')
    .action(async () => {
      const { colors } = io
      const tty = process.stdout.isTTY === true
      const term = process.env.TERM ?? '(unset)'
      const noColor = process.env.NO_COLOR ?? '(unset)'
      const forceColor = process.env.FORCE_COLOR ?? '(unset)'
      const ci = process.env.CI ?? '(unset)'
      const npm = process.env.npm_lifecycle_event ?? '(unset)'

      io.stdout(colors.bold('Environment'))
      io.stdout(
        `  isTTY:        ${tty ? colors.success('✓ true') : colors.warn('✗ false / undefined')}`,
      )
      io.stdout(`  TERM:         ${term}`)
      io.stdout(`  NO_COLOR:     ${noColor}`)
      io.stdout(`  FORCE_COLOR:  ${forceColor}`)
      io.stdout(`  CI:           ${ci}`)
      io.stdout(`  npm script:   ${npm}`)
      io.stdout('')

      io.stdout(colors.bold('chalk'))
      io.stdout(
        `  level:        ${chalk.level} ${chalk.level === 0 ? colors.warn('(no color)') : colors.success('(color on)')}`,
      )
      io.stdout('')

      io.stdout(colors.bold('Color sample — each line should look distinct'))
      io.stdout(`  ${colors.success('  success  this should be GREEN  ✓')}`)
      io.stdout(`  ${colors.error('  error    this should be RED    ✗')}`)
      io.stdout(`  ${colors.warn('  warn     this should be YELLOW ⚠')}`)
      io.stdout(`  ${colors.hint('  hint     this should be DIM/GREY')}`)
      io.stdout(`  ${colors.bold('  bold     this should be BOLD')}`)
      io.stdout(`  ${colors.resource('  resource this should be CYAN + BOLD')}`)
      io.stdout('')

      io.stdout(colors.bold('Spinner sample (1.5s)'))
      const sp = io.spinner('opening a spinner — should animate')
      await new Promise((r) => setTimeout(r, 1500))
      sp.succeed(`resolved — ${colors.success('this should have a green ✔ in front')}`)
      io.stdout('')

      if (!tty && chalk.level === 0) {
        io.stdout(
          colors.warn(
            'Heads up: isTTY is false AND chalk.level is 0 — your terminal looks non-interactive. ' +
              'Try `FORCE_COLOR=1 rando doctor` to force colors and see if your terminal CAN render ANSI.',
          ),
        )
      } else if (chalk.level === 0) {
        io.stdout(
          colors.warn(
            'chalk.level is 0 (colors disabled). If isTTY says true, this is a chalk detection ' +
              'bug — please open an issue with the output above.',
          ),
        )
      } else {
        io.stdout(
          colors.hint(
            'If everything above looked like plain text, your terminal may not be rendering ANSI ' +
              'escape sequences. Try a different terminal app, or check your color theme settings.',
          ),
        )
      }
    })
}
