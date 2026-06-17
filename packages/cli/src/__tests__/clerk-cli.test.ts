// Tests for the Clerk CLI adapter. Stubs spawnSync to verify the
// `clerk api` invocation shape + error mapping without needing the
// real binary on PATH.

import { describe, expect, it, vi } from 'vitest'
import type { spawnSync as spawnSyncType, SpawnSyncReturns } from 'node:child_process'
import { ClerkCliAdapter } from '../adapters/clerk-cli'
import { ProviderApiError } from '../domain/errors'

function ok(stdout: string): SpawnSyncReturns<string> {
  return { status: 0, stdout, stderr: '', pid: 1, output: ['', stdout, ''], signal: null }
}
function fail(stdout: string, stderr = ''): SpawnSyncReturns<string> {
  return { status: 1, stdout, stderr, pid: 1, output: ['', stdout, stderr], signal: null }
}

function adapter(spawn: ReturnType<typeof vi.fn>): ClerkCliAdapter {
  return new ClerkCliAdapter({
    spawn: spawn as unknown as typeof spawnSyncType,
    secretKey: 'sk_test_FAKE',
  })
}

describe('ClerkCliAdapter', () => {
  it('whoami parses /users/count and returns the total', async () => {
    const spawn = vi.fn((_cmd: string, _args: string[]) => ok('{"total_count":7}'))
    const result = await adapter(spawn).whoami()
    expect(result).toEqual({ count: 7 })
    const args = spawn.mock.calls[0]?.[1] as string[]
    expect(args).toEqual([
      'clerk@latest',
      'api',
      '-X',
      'GET',
      '/users/count',
      '--secret-key',
      'sk_test_FAKE',
      '--yes',
    ])
  })

  it('ensureSvixApp returns alreadyExists=false on first create', async () => {
    const spawn = vi.fn(() => ok('{"object":"svix_app"}'))
    const result = await adapter(spawn).ensureSvixApp()
    expect(result).toEqual({ alreadyExists: false })
  })

  it('ensureSvixApp suppresses "already exists" errors as idempotent', async () => {
    const spawn = vi.fn(() => fail('{"errors":[{"message":"Svix app already exists"}]}'))
    const result = await adapter(spawn).ensureSvixApp()
    expect(result).toEqual({ alreadyExists: true })
  })

  it('ensureSvixApp throws ProviderApiError for non-already-exists failures', async () => {
    const spawn = vi.fn(() => fail('{"errors":[{"message":"unauthorized"}]}'))
    await expect(adapter(spawn).ensureSvixApp()).rejects.toBeInstanceOf(ProviderApiError)
  })

  it('getSvixDashboardUrl returns the url field from the response', async () => {
    const spawn = vi.fn(() => ok('{"url":"https://app.svix.com/login#token=abc"}'))
    const result = await adapter(spawn).getSvixDashboardUrl()
    expect(result).toEqual({ url: 'https://app.svix.com/login#token=abc' })
  })

  it('getSvixDashboardUrl throws when the body has no url', async () => {
    const spawn = vi.fn(() => ok('{}'))
    await expect(adapter(spawn).getSvixDashboardUrl()).rejects.toBeInstanceOf(ProviderApiError)
  })

  it('createUser POSTs the expected body and returns id + email', async () => {
    const spawn = vi.fn((_cmd: string, _args: string[]) =>
      ok(
        JSON.stringify({
          id: 'user_123',
          email_addresses: [{ email_address: 'a@example.com' }],
        }),
      ),
    )
    const result = await adapter(spawn).createUser({
      email: 'a@example.com',
      password: 'pw',
      firstName: 'Ada',
    })
    expect(result).toEqual({ id: 'user_123', email: 'a@example.com' })
    const args = spawn.mock.calls[0]?.[1] as string[]
    const dataIdx = args.indexOf('-d')
    expect(JSON.parse(args[dataIdx + 1]!)).toEqual({
      email_address: ['a@example.com'],
      password: 'pw',
      first_name: 'Ada',
    })
  })

  it('surfaces the long_message from Clerk error JSON', async () => {
    const spawn = vi.fn(() =>
      fail('{"errors":[{"message":"oops","long_message":"password too short"}]}'),
    )
    await expect(adapter(spawn).createUser({ email: 'a@b.com', password: 'x' })).rejects.toThrow(
      /password too short/,
    )
  })
})
