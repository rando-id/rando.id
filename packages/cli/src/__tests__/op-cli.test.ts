// Tests for the 1Password CLI adapter. Stubs `spawnSync` to verify
// arg construction + error mapping without needing `op` on PATH.

import { describe, expect, it, vi } from 'vitest'
import type { spawnSync as spawnSyncType, SpawnSyncReturns } from 'node:child_process'
import { OpCliProvider } from '../adapters/op-cli'
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

function adapter(spawn: ReturnType<typeof vi.fn>): OpCliProvider {
  return new OpCliProvider({
    spawn: spawn as unknown as typeof spawnSyncType,
  })
}

describe('OpCliProvider', () => {
  describe('whoami', () => {
    it('returns identity when signed in', async () => {
      const spawn = vi.fn(() =>
        ok('{"url":"https://my.1password.com","user_email":"dev@rando.id"}'),
      )
      const me = await adapter(spawn).whoami()
      expect(me).toEqual({ url: 'https://my.1password.com', account: 'dev@rando.id' })
      expect(spawn).toHaveBeenCalledWith(
        'op',
        ['whoami', '--format=json'],
        expect.objectContaining({ encoding: 'utf-8' }),
      )
    })

    it('throws ProviderApiError when not signed in', async () => {
      const spawn = vi.fn(() => fail('not currently signed in', 1))
      await expect(adapter(spawn).whoami()).rejects.toBeInstanceOf(ProviderApiError)
    })

    it('prepends --account when configured', async () => {
      const spawn = vi.fn(() => ok('{"url":"https://x","user_email":"a@b"}'))
      const a = new OpCliProvider({
        spawn: spawn as unknown as typeof spawnSyncType,
        account: 'APT7PAMC',
      })
      await a.whoami()
      expect(spawn).toHaveBeenCalledWith(
        'op',
        ['--account', 'APT7PAMC', 'whoami', '--format=json'],
        expect.anything(),
      )
    })

    it('omits --account when not configured', async () => {
      const spawn = vi.fn(() => ok('{"url":"https://x","user_email":"a@b"}'))
      const a = new OpCliProvider({ spawn: spawn as unknown as typeof spawnSyncType })
      await a.whoami()
      expect(spawn).toHaveBeenCalledWith('op', ['whoami', '--format=json'], expect.anything())
    })
  })

  describe('listAccounts', () => {
    it('parses the JSON array and maps each account', async () => {
      const spawn = vi.fn(() =>
        ok(
          JSON.stringify([
            {
              url: 'iamnewton.1password.com',
              email: 'a@b',
              user_uuid: 'USER1',
              account_uuid: 'ACC1',
            },
            {
              url: 'work.1password.com',
              email: 'c@d',
              user_uuid: 'USER2',
              account_uuid: 'ACC2',
            },
          ]),
        ),
      )
      const accounts = await adapter(spawn).listAccounts()
      expect(accounts).toEqual([
        { accountUuid: 'ACC1', userUuid: 'USER1', url: 'iamnewton.1password.com', email: 'a@b' },
        { accountUuid: 'ACC2', userUuid: 'USER2', url: 'work.1password.com', email: 'c@d' },
      ])
    })

    it('does NOT prepend --account (listing is account-agnostic)', async () => {
      const spawn = vi.fn(() => ok('[]'))
      const a = new OpCliProvider({
        spawn: spawn as unknown as typeof spawnSyncType,
        account: 'SOMEACCOUNT',
      })
      await a.listAccounts()
      const call = (spawn.mock.calls[0] ?? []) as unknown as [string, string[], unknown]
      expect(call[1]).toEqual(['account', 'list', '--format=json'])
      expect((call[1] ?? []).includes('--account')).toBe(false)
    })

    it('returns empty array when op outputs nothing', async () => {
      const spawn = vi.fn(() => ok(''))
      const accounts = await adapter(spawn).listAccounts()
      expect(accounts).toEqual([])
    })

    it('throws when op fails', async () => {
      const spawn = vi.fn(() => fail('op error', 1))
      await expect(adapter(spawn).listAccounts()).rejects.toBeInstanceOf(ProviderApiError)
    })
  })

  describe('read', () => {
    it('returns the literal field value', async () => {
      const spawn = vi.fn(() => ok('the-token-value'))
      const v = await adapter(spawn).read('op://Rando/NEON_API_KEY/credential')
      expect(v).toBe('the-token-value')
      expect(spawn).toHaveBeenCalledWith(
        'op',
        ['read', 'op://Rando/NEON_API_KEY/credential', '--no-newline'],
        expect.anything(),
      )
    })

    it('throws ProviderApiError when reference is missing', async () => {
      const spawn = vi.fn(() => fail('item "NEON_API_KEY" not found in vault "Rando"', 1))
      await expect(adapter(spawn).read('op://Rando/NEON_API_KEY/credential')).rejects.toMatchObject(
        {
          provider: '1password',
          status: 404,
        },
      )
    })

    it('throws on spawn error (op binary not on PATH)', async () => {
      const spawn = vi.fn(() => ({
        ...fail(''),
        error: new Error('spawn op ENOENT'),
      }))
      await expect(adapter(spawn).read('op://x/y/z')).rejects.toMatchObject({
        provider: '1password',
        body: expect.stringContaining('ENOENT'),
      })
    })
  })

  describe('write', () => {
    it('edits an existing item when probe succeeds', async () => {
      // First call: `op item get` succeeds → item exists.
      // Second call: `op item edit` succeeds.
      const spawn = vi
        .fn()
        .mockReturnValueOnce(ok('{"id":"abc","title":"NEON_API_KEY"}'))
        .mockReturnValueOnce(ok(''))
      await adapter(spawn).write({
        vault: 'Rando',
        item: 'NEON_API_KEY',
        field: 'credential',
        value: 'new-value',
      })
      expect(spawn).toHaveBeenNthCalledWith(
        2,
        'op',
        ['item', 'edit', 'NEON_API_KEY', '--vault=Rando', 'credential=new-value'],
        expect.anything(),
      )
    })

    it('creates a new item when probe fails', async () => {
      const spawn = vi.fn().mockReturnValueOnce(fail('not found', 1)).mockReturnValueOnce(ok(''))
      await adapter(spawn).write({
        vault: 'Rando',
        item: 'NEW_KEY',
        field: 'credential',
        value: 'v',
      })
      expect(spawn).toHaveBeenNthCalledWith(
        2,
        'op',
        [
          'item',
          'create',
          '--title=NEW_KEY',
          '--vault=Rando',
          '--category=API Credential',
          'credential=v',
        ],
        expect.anything(),
      )
    })

    it('throws ProviderApiError when edit fails on existing item', async () => {
      const spawn = vi
        .fn()
        .mockReturnValueOnce(ok('{"id":"abc"}'))
        .mockReturnValueOnce(fail('permission denied', 1))
      await expect(
        adapter(spawn).write({
          vault: 'Rando',
          item: 'NEON_API_KEY',
          field: 'credential',
          value: 'v',
        }),
      ).rejects.toBeInstanceOf(ProviderApiError)
    })
  })
})
