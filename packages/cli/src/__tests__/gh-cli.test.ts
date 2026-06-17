// Tests for the GitHub CLI adapter. Stubs spawnSync to verify arg
// construction + stdin piping for secret values (so they don't show
// up in argv / ps output).

import { describe, expect, it, vi } from 'vitest'
import type { spawnSync as spawnSyncType, SpawnSyncReturns } from 'node:child_process'
import { GhCliProvider } from '../adapters/gh-cli'
import { ProviderApiError } from '../domain/errors'

function ok(stdout: string): SpawnSyncReturns<string> {
  return {
    status: 0,
    stdout,
    stderr: '',
    pid: 1,
    output: ['', stdout, ''],
    signal: null,
  }
}
function fail(stderr: string, code = 1): SpawnSyncReturns<string> {
  return {
    status: code,
    stdout: '',
    stderr,
    pid: 1,
    output: ['', '', stderr],
    signal: null,
  }
}

function adapter(spawn: ReturnType<typeof vi.fn>): GhCliProvider {
  return new GhCliProvider({ spawn: spawn as unknown as typeof spawnSyncType })
}

describe('GhCliProvider', () => {
  describe('whoami', () => {
    it('returns the authenticated login', async () => {
      const spawn = vi.fn(() => ok('newton'))
      const me = await adapter(spawn).whoami()
      expect(me).toEqual({ login: 'newton' })
      expect(spawn).toHaveBeenCalledWith(
        'gh',
        ['api', 'user', '--jq', '.login'],
        expect.objectContaining({ encoding: 'utf-8' }),
      )
    })

    it('throws ProviderApiError with 401 when not authenticated', async () => {
      const spawn = vi.fn(() => fail('To get started with GitHub CLI, please run...', 4))
      await expect(adapter(spawn).whoami()).rejects.toMatchObject({
        provider: 'github',
        status: 401,
      })
    })
  })

  describe('setRepoSecret', () => {
    it('pipes the value via stdin (not argv) so it stays out of ps output', async () => {
      const spawn = vi.fn(() => ok(''))
      await adapter(spawn).setRepoSecret({
        repo: 'rando-id/rando',
        name: 'OP_SERVICE_ACCOUNT_TOKEN',
        value: 'super-secret-token',
      })
      expect(spawn).toHaveBeenCalledWith(
        'gh',
        ['secret', 'set', 'OP_SERVICE_ACCOUNT_TOKEN', '--repo', 'rando-id/rando'],
        expect.objectContaining({
          encoding: 'utf-8',
          input: 'super-secret-token',
        }),
      )
      // Regression guard: secret must NOT appear in argv anywhere.
      const callArgs = (spawn.mock.calls[0] ?? []) as unknown as [string, string[], unknown]
      const args = callArgs[1] ?? []
      expect(args).not.toContain('super-secret-token')
      expect(args).not.toContain('--body')
    })

    it('throws ProviderApiError 401 when auth message is in stderr', async () => {
      const spawn = vi.fn(() => fail('authentication required'))
      await expect(
        adapter(spawn).setRepoSecret({ repo: 'a/b', name: 'X', value: 'v' }),
      ).rejects.toMatchObject({ provider: 'github', status: 401 })
    })

    it('throws ProviderApiError 500 for other failures', async () => {
      const spawn = vi.fn(() => fail('HTTP 422: validation failed'))
      await expect(
        adapter(spawn).setRepoSecret({ repo: 'a/b', name: 'X', value: 'v' }),
      ).rejects.toMatchObject({ provider: 'github', status: 500 })
    })

    it('surfaces spawn errors (gh not on PATH)', async () => {
      const spawn = vi.fn(() => ({
        ...fail(''),
        error: new Error('spawn gh ENOENT'),
      }))
      await expect(
        adapter(spawn).setRepoSecret({ repo: 'a/b', name: 'X', value: 'v' }),
      ).rejects.toBeInstanceOf(ProviderApiError)
    })
  })
})
