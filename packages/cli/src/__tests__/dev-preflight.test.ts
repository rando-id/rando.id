import { describe, expect, it } from 'vitest'
import { runPreflight } from '../dev/preflight'

describe('runPreflight', () => {
  it('passes when Docker is up and CLOUDFLARE_TUNNEL_TOKEN is set', () => {
    const result = runPreflight({
      env: { CLOUDFLARE_TUNNEL_TOKEN: 'token-abc' },
      runDocker: () => true,
    })
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('reports a Docker issue when daemon is unreachable', () => {
    const result = runPreflight({
      env: { CLOUDFLARE_TUNNEL_TOKEN: 'token' },
      runDocker: () => false,
    })
    expect(result.ok).toBe(false)
    expect(result.issues.join('\n')).toMatch(/Docker daemon/)
  })

  it('reports a tunnel-token issue when CLOUDFLARE_TUNNEL_TOKEN is unset', () => {
    const result = runPreflight({
      env: {},
      runDocker: () => true,
    })
    expect(result.ok).toBe(false)
    expect(result.issues.join('\n')).toMatch(/CLOUDFLARE_TUNNEL_TOKEN/)
  })

  it('reports both issues independently', () => {
    const result = runPreflight({ env: {}, runDocker: () => false })
    expect(result.issues).toHaveLength(2)
  })
})
