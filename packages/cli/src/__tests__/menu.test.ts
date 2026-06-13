import { describe, expect, it } from 'vitest'
import { isInteractiveCandidate, pickFromMenu } from '../menu'
import { captureIo } from './helpers'

describe('isInteractiveCandidate', () => {
  it('returns {} for empty argv → top-level menu', () => {
    expect(isInteractiveCandidate([])).toEqual({})
  })

  it('returns { group } when argv is a single known group', () => {
    expect(isInteractiveCandidate(['db'])).toEqual({ group: 'db' })
    expect(isInteractiveCandidate(['tunnel'])).toEqual({ group: 'tunnel' })
    expect(isInteractiveCandidate(['deploy'])).toEqual({ group: 'deploy' })
    expect(isInteractiveCandidate(['dns'])).toEqual({ group: 'dns' })
    expect(isInteractiveCandidate(['infra'])).toEqual({ group: 'infra' })
  })

  it('returns null for unknown single arg → let commander handle the typo', () => {
    expect(isInteractiveCandidate(['nope'])).toBeNull()
  })

  it('returns null when argv goes deeper than one segment', () => {
    expect(isInteractiveCandidate(['db', 'project'])).toBeNull()
    expect(isInteractiveCandidate(['db', '--help'])).toBeNull()
  })
})

describe('pickFromMenu', () => {
  it('top-level select chooses a group, then a subcommand', async () => {
    const io = captureIo({
      selectResponses: [
        'db', // pick group "db"
        { label: 'project list', description: '...', argv: ['db', 'project', 'list'] }, // pick item
      ],
    })
    const argv = await pickFromMenu(io.io)
    expect(argv).toEqual(['db', 'project', 'list'])
    // Both selects fired
    expect(io.selectCalls).toHaveLength(2)
    // First select header mentions "pick a command group"
    expect(io.selectCalls[0]?.message).toMatch(/pick a command group/)
    // Second select header references "rando db"
    expect(io.selectCalls[1]?.message).toMatch(/rando db/)
  })

  it('group-mode skips the top-level select', async () => {
    const io = captureIo({
      selectResponses: [{ label: 'list', description: '...', argv: ['tunnel', 'list'] }],
    })
    const argv = await pickFromMenu(io.io, 'tunnel')
    expect(argv).toEqual(['tunnel', 'list'])
    expect(io.selectCalls).toHaveLength(1)
    expect(io.selectCalls[0]?.message).toMatch(/rando tunnel/)
  })

  it('rejects an unknown explicit group', async () => {
    const io = captureIo()
    await expect(pickFromMenu(io.io, 'nope')).rejects.toThrow(/Unknown group/)
  })
})
