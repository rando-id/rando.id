import { describe, expect, it } from 'vitest'
import { assignColors, makeLineBuffer } from '../dev/log-mux'
import type { IoColors } from '../output'

const plainColors: IoColors = {
  success: (s) => s,
  error: (s) => s,
  warn: (s) => s,
  hint: (s) => s,
  bold: (s) => s,
  resource: (s) => s,
}

describe('makeLineBuffer', () => {
  it('emits one prefixed line per newline in the input', () => {
    const lines: string[] = []
    const buf = makeLineBuffer('api', plainColors, 'success', 5, (line) => lines.push(line))
    buf.write('first\nsecond\n')
    expect(lines).toEqual(['[api  ] first', '[api  ] second'])
  })

  it('buffers partial lines across multiple write calls', () => {
    const lines: string[] = []
    const buf = makeLineBuffer('web', plainColors, 'success', 5, (line) => lines.push(line))
    buf.write('partial ')
    buf.write('continues\n')
    expect(lines).toEqual(['[web  ] partial continues'])
  })

  it('emits no lines for a trailing partial until flush is called', () => {
    const lines: string[] = []
    const buf = makeLineBuffer('admin', plainColors, 'warn', 5, (line) => lines.push(line))
    buf.write('done\nstart of next')
    expect(lines).toEqual(['[admin] done'])
    buf.flush()
    expect(lines).toEqual(['[admin] done', '[admin] start of next'])
  })

  it('handles Buffer chunks the same as strings', () => {
    const lines: string[] = []
    const buf = makeLineBuffer('api', plainColors, 'success', 3, (line) => lines.push(line))
    buf.write(Buffer.from('hi\n'))
    expect(lines).toEqual(['[api] hi'])
  })

  it('flushes nothing when there is no trailing partial', () => {
    const lines: string[] = []
    const buf = makeLineBuffer('api', plainColors, 'success', 3, (line) => lines.push(line))
    buf.write('a\n')
    buf.flush()
    expect(lines).toEqual(['[api] a'])
  })
})

describe('assignColors', () => {
  it('assigns one color per name, deterministically', () => {
    const c1 = assignColors(['api', 'web', 'admin', 'native'])
    const c2 = assignColors(['api', 'web', 'admin', 'native'])
    expect(c1).toEqual(c2)
    // Distinct first-three colors.
    const seen = new Set([c1.get('api'), c1.get('web'), c1.get('admin')])
    expect(seen.size).toBe(3)
  })

  it('cycles palette when name count exceeds palette length', () => {
    const names = Array.from({ length: 12 }, (_, i) => `n${i}`)
    const map = assignColors(names)
    expect(map.size).toBe(12)
  })
})
