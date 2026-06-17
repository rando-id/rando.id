import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEnvExample } from '../init/env-example'

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'env-example-'))
  const path = join(dir, '.env.example')
  writeFileSync(path, content)
  return path
}

describe('readEnvExample', () => {
  it('returns var names declared as KEY=...', () => {
    const path = tmpFile(
      [
        'NEON_API_KEY=napi_xxx',
        'VERCEL_TOKEN=',
        'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx',
      ].join('\n'),
    )
    expect(readEnvExample(path)).toEqual([
      'NEON_API_KEY',
      'VERCEL_TOKEN',
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    ])
  })

  it('ignores blank lines + # comments', () => {
    const path = tmpFile(
      ['# Header comment', '', 'A=1', '   ', '# inline comment-style line', 'B=2'].join('\n'),
    )
    expect(readEnvExample(path)).toEqual(['A', 'B'])
  })

  it('skips malformed lines (lowercase, no =, etc.)', () => {
    const path = tmpFile(['lowercase=bad', 'GOOD=1', 'NO_EQUALS', '123BAD=x'].join('\n'))
    expect(readEnvExample(path)).toEqual(['GOOD'])
  })

  it('returns [] for missing files', () => {
    expect(readEnvExample('/tmp/does-not-exist/.env.example')).toEqual([])
  })
})
