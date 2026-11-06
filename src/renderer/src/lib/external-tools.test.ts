import { describe, expect, it } from 'vitest'
import type { ExternalItem } from '../../../shared/ipc'
import { filterExternal, groupExternal, serverFromForm, signInHint } from './external-tools'

const item = (name: string, fields: Partial<ExternalItem> = {}): ExternalItem => ({
  id: name,
  name,
  kind: 'mcp',
  source: 'detected',
  origin: 'claude-code',
  summary: '',
  description: null,
  enabled: false,
  unavailable: null,
  changed: false,
  mayMoveFunds: false,
  needsSignIn: false,
  signedIn: false,
  ...fields,
})

describe('groupExternal', () => {
  it('keeps sources in a fixed order and leaves out an empty one', () => {
    const groups = groupExternal([item('a', { source: 'added' }), item('b', { source: 'bundled' })])
    expect(groups.map(({ source, title }) => [source, title])).toEqual([
      ['bundled', 'Shipped with Ink'],
      ['added', 'Added by you'],
    ])
  })

  it('puts what is on first and what cannot be turned on last', () => {
    const groups = groupExternal([item('c', { unavailable: 'Needs a shell' }), item('b'), item('z', { enabled: true }), item('a')])
    expect(groups[0]?.items.map(({ name }) => name)).toEqual(['z', 'a', 'b', 'c'])
  })

  it('leaves its input alone', () => {
    const items = [item('b'), item('a')]
    groupExternal(items)
    expect(items.map(({ name }) => name)).toEqual(['b', 'a'])
  })
})

describe('filterExternal', () => {
  const items = [item('near-tools', { description: 'Reads the chain' }), item('guide', { kind: 'skill' })]

  it('shows everything with no query', () => {
    expect(filterExternal(items, '  ')).toHaveLength(2)
  })

  it('matches name, kind and description in any order and case', () => {
    expect(filterExternal(items, 'NEAR').map(({ name }) => name)).toEqual(['near-tools'])
    expect(filterExternal(items, 'skill').map(({ name }) => name)).toEqual(['guide'])
    expect(filterExternal(items, 'chain reads').map(({ name }) => name)).toEqual(['near-tools'])
    expect(filterExternal(items, 'nothing')).toEqual([])
  })
})

describe('serverFromForm', () => {
  it('reads a command with its arguments and variables', () => {
    expect(serverFromForm({ name: ' near ', target: ' npx ', args: ' -y  near-mcp ', envNames: 'NEAR_KEY, OTHER_KEY' })).toEqual({
      name: 'near',
      command: 'npx',
      args: ['-y', 'near-mcp'],
      envNames: ['NEAR_KEY', 'OTHER_KEY'],
    })
  })

  it('reads an address, ignoring the fields that only apply to a command', () => {
    expect(serverFromForm({ name: 'r', target: 'https://example.test/mcp', args: 'x', envNames: 'Y' })).toEqual({
      name: 'r',
      url: 'https://example.test/mcp',
    })
  })
})

describe('signInHint', () => {
  it('names the tool and says what to do', () => {
    expect(signInHint(['near-tools'])).toBe(
      "near-tools needs sign-in, so chats don't get its tools. Sign in under Settings, Tools and skills, then start a new chat.",
    )
  })

  it('reads properly for several', () => {
    expect(signInHint(['one', 'two'])).toContain('one, two need sign-in, so chats don\'t get their tools.')
  })
})
