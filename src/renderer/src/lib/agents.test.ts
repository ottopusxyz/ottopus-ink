import { describe, expect, it } from 'vitest'
import type { AgentStatus } from '../../../shared/ipc'
import { chooseAgent, describeAgent } from './agents'

const status = (over: Partial<AgentStatus> & Pick<AgentStatus, 'id' | 'state'>): AgentStatus => ({
  path: '/home/me/.local/bin/agent',
  version: '1.2.3',
  missing: [],
  signedIn: true,
  ...over,
})

describe('describeAgent', () => {
  it('says ready with the version, and notes an unknown sign-in', () => {
    expect(describeAgent(status({ id: 'codex', state: 'ready' }))).toEqual({
      label: 'Ready',
      hint: 'Version 1.2.3, signed in.',
    })
    expect(describeAgent(status({ id: 'opencode', state: 'ready', signedIn: null })).hint).toMatch(/couldn't read/)
  })

  it('gives the command that fixes each problem', () => {
    expect(describeAgent(status({ id: 'claude-code', state: 'signed-out' })).command).toBe('claude auth login')
    expect(describeAgent(status({ id: 'codex', state: 'missing', path: null })).command).toBe(
      'npm install -g @openai/codex',
    )
    const outdated = describeAgent(status({ id: 'claude-code', state: 'outdated', missing: ['--plugin-dir'] }))
    expect(outdated).toMatchObject({ label: 'Needs an update', command: 'claude update' })
    expect(outdated.hint).toContain('--plugin-dir')
  })

  it('has no command for a binary that does not start', () => {
    const broken = describeAgent(status({ id: 'codex', state: 'broken', version: null }))
    expect(broken.command).toBeUndefined()
    expect(broken.hint).toContain('/home/me/.local/bin/agent')
  })
})

describe('chooseAgent', () => {
  const agents = [
    status({ id: 'claude-code', state: 'signed-out' }),
    status({ id: 'codex', state: 'ready' }),
    status({ id: 'opencode', state: 'ready' }),
  ]

  it('keeps the picked agent while it is ready', () => {
    expect(chooseAgent(agents, 'opencode')).toBe('opencode')
  })

  it('falls back to the first ready agent', () => {
    expect(chooseAgent(agents, null)).toBe('codex')
    expect(chooseAgent(agents, 'claude-code')).toBe('codex')
  })

  it('is null when nothing is ready', () => {
    expect(chooseAgent([status({ id: 'codex', state: 'missing' })], null)).toBeNull()
  })
})
