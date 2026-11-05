import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '../../shared/ipc'
import { lockWatcher } from './lockdown'

const ours = 'mcp__ottopus-ink__get_accounts'
const report = (fields: Partial<Extract<ChatEvent, { type: 'session' }>> = {}): ChatEvent => ({
  type: 'session',
  tools: [ours],
  servers: ['ottopus-ink'],
  plugins: [],
  model: null,
  ...fields,
})
const done: ChatEvent = { type: 'turn-end', outcome: 'done', error: null }

describe('lockWatcher on a report', () => {
  const check = (event: ChatEvent, connected = true) => lockWatcher(() => connected)(event)

  it('finds nothing in a session with only Ink tools', () => {
    expect(check(report())).toEqual([])
  })

  it('finds nothing in a session with no tools, which has nothing to reach', () => {
    expect(check(report({ tools: [], servers: [] }), false)).toEqual([])
  })

  it.each([
    ['a built-in tool', { tools: [ours, 'Bash'] }, 'the tool Bash'],
    ['the Skill tool', { tools: [ours, 'Skill'] }, 'the tool Skill'],
    ['the other Ottopus connector', { tools: ['mcp__ottopus__get_plan'] }, 'the tool mcp__ottopus__get_plan'],
    ['a look-alike prefix', { tools: ['mcp__ottopus-ink-evil__x'] }, 'the tool mcp__ottopus-ink-evil__x'],
    ['another server', { servers: ['ottopus-ink', 'other'] }, 'the MCP server other'],
    ['a plugin', { plugins: ['dropped-in'] }, 'the plugin dropped-in'],
    ['an unreadable tool list', { tools: null }, "a tool list Ink can't read"],
    ['an unreadable server list', { servers: null }, "a server list Ink can't read"],
    ['an unreadable plugin list', { plugins: null }, "a plugin list Ink can't read"],
  ])('finds %s', (_name, fields, expected) => {
    expect(check(report(fields))).toContain(expected)
  })

  it('names only the first few of a long list', () => {
    const found = check(report({ tools: Array.from({ length: 25 }, (_, i) => `tool${i}`) }))
    expect(found).toHaveLength(11)
    expect(found?.at(-1)).toBe('15 more')
  })

  it('finds Ink tools that never came through the shim', () => {
    expect(check(report(), false)).toEqual(["ottopus-ink tools that didn't come through Ink's shim"])
  })
})

describe('lockWatcher across a turn', () => {
  it('stays quiet through a normal turn, on every turn', () => {
    const watch = lockWatcher(() => true)
    const call: ChatEvent = { type: 'tool-call', id: 'a', name: ours, input: '{}' }
    for (let turn = 0; turn < 2; turn++) {
      expect(watch(report())).toEqual([])
      expect(watch(call)).toBeNull()
      expect(watch({ type: 'text', text: 'hi' })).toBeNull()
      expect(watch(done)).toBeNull()
    }
  })

  it('finds a later report that has changed', () => {
    const watch = lockWatcher(() => true)
    watch(report())
    watch(done)
    expect(watch(report({ tools: [ours, 'Read'] }))).toEqual(['the tool Read'])
  })

  it('finds a call to a tool the report left out', () => {
    const watch = lockWatcher(() => true)
    watch(report())
    expect(watch({ type: 'tool-call', id: 'a', name: 'Bash', input: '{}' })).toEqual(['a call to Bash'])
  })

  it('finds a subagent at work', () => {
    const watch = lockWatcher(() => true)
    watch(report())
    expect(watch({ type: 'subagent' })).toEqual(['a subagent at work'])
  })

  it('finds a call before any report', () => {
    const watch = lockWatcher(() => true)
    expect(watch({ type: 'tool-call', id: 'a', name: ours, input: '{}' })).toEqual([
      `a call to ${ours} before the agent reported its tools`,
    ])
  })

  it('finds a finished turn that never reported, including a later one', () => {
    const first = lockWatcher(() => true)
    expect(first(done)).toEqual(['a finished turn with no report of its tools'])
    const later = lockWatcher(() => true)
    later(report())
    later(done)
    expect(later(done)).toEqual(['a finished turn with no report of its tools'])
  })

  it.each(['stopped', 'failed'] as const)('lets a %s turn end without a report', (outcome) => {
    const watch = lockWatcher(() => true)
    expect(watch({ type: 'turn-end', outcome, error: null })).toBeNull()
  })
})
