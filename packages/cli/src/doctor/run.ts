// Orchestrator + table renderer for `rando doctor`. Each check is a
// small async fn; the runner kicks them off in parallel (they're all
// I/O-bound — env reads, token validation, file stat), then renders a
// table grouped by section.

import type { Io, IoColors } from '../output'
import type { Check, CheckResult, CheckStatus, DoctorReport } from './types'

const STATUS_GLYPH: Record<CheckStatus, (colors: IoColors) => string> = {
  ok: (c) => c.success('✓'),
  warn: (c) => c.warn('⚠'),
  fail: (c) => c.error('✗'),
}

/** Run every check (in parallel) and produce a structured report. */
export async function runChecks(checks: Check[]): Promise<DoctorReport> {
  const results = await Promise.all(
    checks.map(async (c) => ({ check: c, result: await safeRun(c) })),
  )
  const ok = results.every((r) => r.result.status === 'ok')
  const hasFailures = results.some((r) => r.result.status === 'fail')
  return { results, ok, hasFailures }
}

/**
 * Render the report to the Io. Groups by `check.section`, prints a
 * status glyph + subject + hint per row.
 */
export function renderReport(io: Io, report: DoctorReport): void {
  const { colors } = io

  const sections = new Map<string, DoctorReport['results']>()
  for (const entry of report.results) {
    const arr = sections.get(entry.check.section) ?? []
    arr.push(entry)
    sections.set(entry.check.section, arr)
  }

  for (const [section, entries] of sections) {
    io.stdout(colors.bold(section))
    for (const { check, result } of entries) {
      const glyph = STATUS_GLYPH[result.status](colors)
      io.stdout(`  ${glyph}  ${check.name.padEnd(28)}${result.subject}`)
      if (result.hint && result.status !== 'ok') {
        io.stdout(`     ${colors.hint(result.hint)}`)
      }
    }
    io.stdout('')
  }

  if (report.ok) {
    io.stdout(`${colors.success('✓')} all checks passed`)
  } else if (report.hasFailures) {
    io.stdout(
      `${colors.error('✗')} ${report.results.filter((r) => r.result.status === 'fail').length} check(s) failed — run \`rando init\` to fix interactively`,
    )
  } else {
    io.stdout(`${colors.warn('⚠')} all checks passed with warnings`)
  }
}

/** Swallow per-check exceptions so one broken check doesn't tank doctor. */
async function safeRun(check: Check): Promise<CheckResult> {
  try {
    return await check.run()
  } catch (e) {
    return {
      status: 'fail',
      subject: 'check threw',
      hint: e instanceof Error ? e.message : String(e),
    }
  }
}
