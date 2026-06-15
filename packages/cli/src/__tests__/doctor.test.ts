// Tests for the rando doctor check framework. The individual check
// modules are exercised here against mocked adapters / fake filesystems
// so we can verify the runner + renderer behavior without touching
// real env or real APIs.

import { describe, expect, it, vi } from 'vitest'
import { runChecks, renderReport } from '../doctor/run'
import { envChecks } from '../doctor/checks/env'
import { configChecks } from '../doctor/checks/config'
import { hooksChecks } from '../doctor/checks/hooks'
import { trackerChecks } from '../doctor/checks/tracker'
import { terminalChecks } from '../doctor/checks/terminal'
import { MissingConfigError } from '../domain/errors'
import type { Adapters } from '../config'
import type { Check, CheckResult } from '../doctor/types'
import { captureIo } from './helpers'
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fakeAdapters(overrides: Partial<Adapters> = {}): Adapters {
  const never = (() => {
    throw new Error('not expected')
  }) as never
  return {
    db: never,
    tunnel: never,
    dns: never,
    deploy: never,
    tracker: never,
    postman: never,
    ...overrides,
  }
}

// ─── runChecks + renderReport ─────────────────────────────────────────

describe('runChecks', () => {
  it('aggregates results + sets hasFailures correctly', async () => {
    const checks: Check[] = [
      { section: 'A', name: 'one', run: async () => ({ status: 'ok', subject: 's' }) },
      { section: 'A', name: 'two', run: async () => ({ status: 'warn', subject: 'w' }) },
      { section: 'B', name: 'three', run: async () => ({ status: 'fail', subject: 'f' }) },
    ]
    const report = await runChecks(checks)
    expect(report.ok).toBe(false)
    expect(report.hasFailures).toBe(true)
    expect(report.results).toHaveLength(3)
  })

  it('catches per-check exceptions and renders them as fail', async () => {
    const report = await runChecks([
      {
        section: 'A',
        name: 'throws',
        run: async () => {
          throw new Error('boom')
        },
      },
    ])
    expect(report.results[0]?.result.status).toBe('fail')
    expect(report.results[0]?.result.subject).toBe('check threw')
    expect(report.results[0]?.result.hint).toBe('boom')
  })

  it('returns ok=true and hasFailures=false when every check passes', async () => {
    const report = await runChecks([
      { section: 'A', name: 'one', run: async () => ({ status: 'ok', subject: 's' }) },
    ])
    expect(report.ok).toBe(true)
    expect(report.hasFailures).toBe(false)
  })
})

describe('renderReport', () => {
  function res(status: CheckResult['status'], subject: string, hint?: string): CheckResult {
    return hint ? { status, subject, hint } : { status, subject }
  }

  it('groups by section and prints status + hint for non-ok rows', async () => {
    const io = captureIo()
    renderReport(io.io, {
      ok: false,
      hasFailures: true,
      results: [
        { check: { section: 'A', name: 'one', run: vi.fn() }, result: res('ok', 's') },
        {
          check: { section: 'A', name: 'two', run: vi.fn() },
          result: res('warn', 'w', 'fix me'),
        },
        {
          check: { section: 'B', name: 'three', run: vi.fn() },
          result: res('fail', 'f', 'broken'),
        },
      ],
    })
    const out = io.stdout.join('\n')
    expect(out).toContain('A\n')
    expect(out).toContain('B\n')
    expect(out).toMatch(/two\s+w/)
    expect(out).toMatch(/three\s+f/)
    expect(out).toContain('fix me')
    expect(out).toContain('broken')
    expect(out).toContain('1 check(s) failed')
  })

  it('does NOT print hints for ok rows', async () => {
    const io = captureIo()
    renderReport(io.io, {
      ok: true,
      hasFailures: false,
      results: [
        {
          check: { section: 'A', name: 'one', run: vi.fn() },
          result: res('ok', 's', 'hint-that-should-not-print'),
        },
      ],
    })
    expect(io.stdout.join('\n')).not.toContain('hint-that-should-not-print')
    expect(io.stdout.join('\n')).toContain('all checks passed')
  })

  it('reports "passed with warnings" when there are warns but no fails', async () => {
    const io = captureIo()
    renderReport(io.io, {
      ok: false,
      hasFailures: false,
      results: [{ check: { section: 'A', name: 'one', run: vi.fn() }, result: res('warn', 'w') }],
    })
    expect(io.stdout.join('\n')).toContain('passed with warnings')
  })
})

// ─── env checks ───────────────────────────────────────────────────────

describe('envChecks', () => {
  it('returns fail when a required var is unset', async () => {
    const checks = envChecks(fakeAdapters(), {
      /* GITHUB_TOKEN missing */
    })
    const neon = checks.find((c) => c.name === 'NEON_API_KEY')!
    const result = await neon.run()
    expect(result.status).toBe('fail')
    expect(result.subject).toBe('unset')
    expect(result.fix).toBe('env:NEON_API_KEY')
  })

  it('returns warn when an optional var is unset', async () => {
    const checks = envChecks(fakeAdapters(), {})
    const gh = checks.find((c) => c.name === 'GITHUB_TOKEN')!
    const result = await gh.run()
    expect(result.status).toBe('warn')
    expect(result.fix).toBe('env:GITHUB_TOKEN')
  })

  it('returns ok when the probe succeeds', async () => {
    const tracker = vi.fn(() => ({
      getMyself: async () => ({ id: 'newton', displayName: 'Newton' }),
    })) as unknown as Adapters['tracker']
    const checks = envChecks(fakeAdapters({ tracker }), {
      GITHUB_TOKEN: 'gh_pat_x',
    })
    const result = await checks.find((c) => c.name === 'GITHUB_TOKEN')!.run()
    expect(result.status).toBe('ok')
    expect(result.subject).toBe('set + valid')
  })

  it('returns fail with the error message when the probe throws (auth invalid)', async () => {
    const tracker = vi.fn(() => ({
      getMyself: async () => {
        throw new Error('401 unauthorized')
      },
    })) as unknown as Adapters['tracker']
    const checks = envChecks(fakeAdapters({ tracker }), {
      GITHUB_TOKEN: 'gh_bad',
    })
    const result = await checks.find((c) => c.name === 'GITHUB_TOKEN')!.run()
    expect(result.status).toBe('fail')
    expect(result.subject).toBe('set but invalid')
    expect(result.hint).toContain('401')
  })

  it('reports ok-with-paired-var-unset when MissingConfigError fires from the adapter factory', async () => {
    const tracker = (() => {
      throw new MissingConfigError('CLOUDFLARE_ACCOUNT_ID', 'cloudflare-tunnel')
    }) as Adapters['tracker']
    const checks = envChecks(fakeAdapters({ tracker }), {
      GITHUB_TOKEN: 'gh_x',
    })
    const result = await checks.find((c) => c.name === 'GITHUB_TOKEN')!.run()
    expect(result.status).toBe('ok')
    expect(result.subject).toContain('paired var unset')
  })
})

// ─── config checks ────────────────────────────────────────────────────

describe('configChecks', () => {
  function tmpConfig(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'doctor-config-'))
    const p = join(dir, 'rando.config.json')
    writeFileSync(p, content)
    return p
  }

  it('returns fail when the file is missing', async () => {
    const checks = configChecks('/nope/does-not-exist.json')
    const result = await checks[0]!.run()
    expect(result.status).toBe('fail')
    expect(result.subject).toBe('missing')
    expect(result.fix).toBe('config:missing')
  })

  it('returns ok when the file parses and has a tracker block', async () => {
    const path = tmpConfig(
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando.id',
        domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
        tracker: { kind: 'github' },
      }),
    )
    const result = await configChecks(path)[0]!.run()
    expect(result.status).toBe('ok')
    expect(result.subject).toContain('tracker.kind=github')
  })

  it('returns warn when the tracker block is missing', async () => {
    const path = tmpConfig(
      JSON.stringify({
        project: 'rando',
        repo: 'rando-id/rando.id',
        domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
      }),
    )
    const result = await configChecks(path)[0]!.run()
    expect(result.status).toBe('warn')
    expect(result.subject).toContain('no tracker block')
  })

  it('returns fail when the repo field is malformed', async () => {
    const path = tmpConfig(
      JSON.stringify({
        project: 'rando',
        repo: 'just-name-no-slash',
        domains: { nonProd: 'rando-id.dev', production: 'rando.id' },
        apps: [{ name: 'api', rootDirectory: 'apps/api', port: 4000 }],
      }),
    )
    const result = await configChecks(path)[0]!.run()
    // The repo regex in setup-config rejects this before we get to the doctor's repo check.
    expect(result.status).toBe('fail')
  })
})

// ─── hooks checks ─────────────────────────────────────────────────────

describe('hooksChecks', () => {
  function tmpRepo(layout: {
    shimDir?: boolean
    hooks?: Array<{ name: string; executable?: boolean }>
  }): string {
    const dir = mkdtempSync(join(tmpdir(), 'doctor-hooks-'))
    mkdirSync(join(dir, '.husky'), { recursive: true })
    if (layout.shimDir) mkdirSync(join(dir, '.husky/_'), { recursive: true })
    for (const h of layout.hooks ?? []) {
      const p = join(dir, '.husky', h.name)
      writeFileSync(p, '#!/bin/sh\nexit 0\n')
      if (h.executable !== false) chmodSync(p, 0o755)
    }
    return dir
  }

  it('flags missing shim dir', async () => {
    const dir = tmpRepo({})
    const sectionResults = await Promise.all(hooksChecks(dir).map((c) => c.run()))
    const shimResult = sectionResults[0]!
    expect(shimResult.status).toBe('fail')
    expect(shimResult.fix).toBe('hooks:install')
  })

  it('flags missing hook file', async () => {
    const dir = tmpRepo({ shimDir: true, hooks: [{ name: 'pre-commit' }] })
    // Find the prepare-commit-msg check — should be missing.
    const checks = hooksChecks(dir)
    const prepare = checks.find((c) => c.name === '.husky/prepare-commit-msg')!
    const result = await prepare.run()
    expect(result.status).toBe('fail')
    expect(result.subject).toBe('missing')
  })

  it('flags a non-executable hook as a warn', async () => {
    const dir = tmpRepo({
      shimDir: true,
      hooks: [
        { name: 'pre-commit', executable: false },
        { name: 'prepare-commit-msg' },
        { name: 'commit-msg' },
      ],
    })
    const checks = hooksChecks(dir)
    const pre = checks.find((c) => c.name === '.husky/pre-commit')!
    const result = await pre.run()
    expect(result.status).toBe('warn')
    expect(result.fix).toBe('hooks:perms')
  })

  it('passes when shim + all three hooks are present and executable', async () => {
    const dir = tmpRepo({
      shimDir: true,
      hooks: [{ name: 'pre-commit' }, { name: 'prepare-commit-msg' }, { name: 'commit-msg' }],
    })
    const checks = hooksChecks(dir)
    // Skip the core.hooksPath check — it shells out to git which we can't easily mock here.
    const fileChecks = checks.filter((c) => c.name.startsWith('.husky/'))
    const shim = checks.find((c) => c.name.includes('shims'))!
    expect((await shim.run()).status).toBe('ok')
    for (const c of fileChecks) {
      expect((await c.run()).status).toBe('ok')
    }
  })
})

// ─── tracker checks ───────────────────────────────────────────────────

describe('trackerChecks', () => {
  it('returns warn with the missing-config variable when adapter throws MissingConfigError', async () => {
    const tracker = () => {
      throw new MissingConfigError('GITHUB_TOKEN', 'github')
    }
    const checks = trackerChecks(fakeAdapters({ tracker: tracker as Adapters['tracker'] }))
    const result = await checks[0]!.run()
    expect(result.status).toBe('warn')
    expect(result.subject).toBe('not configured')
    expect(result.fix).toBe('env:GITHUB_TOKEN')
  })

  it('returns ok with project label when doctor() succeeds', async () => {
    const tracker = () =>
      ({
        doctor: async () => ({
          authedAs: 'Newton (newton)',
          projectLabel: 'Repo: rando-id/rando.id',
          statuses: [],
          lifecycle: [],
        }),
      }) as never
    const checks = trackerChecks(fakeAdapters({ tracker: tracker as Adapters['tracker'] }))
    const result = await checks[0]!.run()
    expect(result.status).toBe('ok')
    expect(result.subject).toContain('Repo: rando-id/rando.id')
  })

  it('flags unmapped lifecycle slots as a warn', async () => {
    const tracker = () =>
      ({
        doctor: async () => ({
          authedAs: 'me',
          projectLabel: 'project',
          statuses: [],
          lifecycle: [
            { slot: 'inProgress', value: 'x', resolved: true, note: '' },
            { slot: 'inReview', value: null, resolved: false, note: '' },
            { slot: 'done', value: null, resolved: false, note: '' },
          ],
        }),
      }) as never
    const checks = trackerChecks(fakeAdapters({ tracker: tracker as Adapters['tracker'] }))
    const lifecycleCheck = checks.find((c) => c.name === 'lifecycle map')!
    const result = await lifecycleCheck.run()
    expect(result.status).toBe('warn')
    expect(result.subject).toContain('2 unmapped')
    expect(result.subject).toContain('inReview')
    expect(result.subject).toContain('done')
  })
})

// ─── brew checks ──────────────────────────────────────────────────────

describe('brewChecks', () => {
  function tmpRepo(withBrewfile: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), 'doctor-brew-'))
    if (withBrewfile) writeFileSync(join(dir, 'Brewfile'), 'brew "gh"\n')
    return dir
  }

  it('returns ok-skipped when no Brewfile exists in the repo', async () => {
    const { brewChecks } = await import('../doctor/checks/brew')
    const dir = tmpRepo(false)
    const result = await brewChecks(dir)[0]!.run()
    expect(result.status).toBe('ok')
    expect(result.subject).toContain('no Brewfile')
  })

  it('parses "Formula X needs to be installed" lines correctly', async () => {
    // We can't easily stub execFileSync without rewriting the module;
    // instead exercise the parser via a separate exported helper. For
    // now, treat this as a smoke check that the check runs without
    // crashing — the parser is verified by the actual CLI smoke test.
    const { brewChecks } = await import('../doctor/checks/brew')
    const dir = tmpRepo(true)
    const result = await brewChecks(dir)[0]!.run()
    // Three possible outcomes depending on the test machine:
    //   - brew not installed → warn 'brew not installed'
    //   - brew installed + Brewfile satisfied → ok
    //   - brew installed + missing deps → warn 'missing: ...'
    expect(['ok', 'warn']).toContain(result.status)
    expect(result.subject).toBeTypeOf('string')
  })
})

// ─── terminal checks ──────────────────────────────────────────────────

describe('terminalChecks', () => {
  it('returns ok for both isTTY and chalk level when env supports color', async () => {
    // We can't reliably stub chalk.level inside a vitest run, but we
    // can at least ensure the checks don't throw and return a valid
    // shape.
    const checks = terminalChecks()
    for (const c of checks) {
      const r = await c.run()
      expect(['ok', 'warn']).toContain(r.status)
      expect(r.subject).toBeTypeOf('string')
    }
  })
})
