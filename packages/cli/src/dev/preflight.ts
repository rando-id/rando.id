// Preflight checks for `rando dev`. Verifies the local environment is
// set up before we start spawning long-running children — surface obvious
// failures early with actionable hints rather than letting the subprocesses
// crash in confusing ways.

import { execFileSync } from 'node:child_process'

export interface PreflightResult {
  ok: boolean
  /** Human-readable issues + remediation hints, in stable order. */
  issues: string[]
}

/**
 * Run all preflight checks. The shape of `env` is injected so tests can
 * pass a synthetic environment without monkey-patching `process.env`.
 *
 * `runDocker` defaults to a real `docker info` invocation but tests
 * provide their own implementation that returns whatever the test
 * scenario demands.
 */
export function runPreflight(options: {
  env: NodeJS.ProcessEnv
  runDocker?: () => boolean
}): PreflightResult {
  const issues: string[] = []

  const dockerUp = options.runDocker ? options.runDocker() : defaultDockerCheck()
  if (!dockerUp) {
    issues.push(
      'Docker daemon is not reachable. Start Docker Desktop (macOS) or `systemctl start docker` (Linux), then re-run.',
    )
  }

  if (!options.env.CLOUDFLARE_TUNNEL_TOKEN) {
    issues.push(
      'CLOUDFLARE_TUNNEL_TOKEN is not set. Run `rando tunnel token <name>` to fetch one and add it to your `.env`.',
    )
  }

  return { ok: issues.length === 0, issues }
}

function defaultDockerCheck(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
