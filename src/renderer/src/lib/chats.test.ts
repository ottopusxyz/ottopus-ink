import { describe, expect, it } from 'vitest'
import { chatTitle, filterChats } from './chats'

describe('chatTitle', () => {
  it('uses the first non-empty line with whitespace collapsed', () => {
    expect(chatTitle('\n  Swap   0.1 ETH\tto USDC  \nthen stake')).toBe('Swap 0.1 ETH to USDC')
  })

  it('cuts long text at a word boundary', () => {
    const title = chatTitle('Move five USDC from Base over to NEAR and then stake all of it with my validator')
    expect(title).toBe('Move five USDC from Base over to NEAR and then…')
    expect(title.length).toBeLessThanOrEqual(48)
  })

  it('cuts mid-word when there is no late space', () => {
    expect(chatTitle('a'.repeat(60), 10)).toBe(`${'a'.repeat(9)}…`)
  })

  it('names an empty chat', () => {
    expect(chatTitle('   \n ')).toBe('New chat')
  })
})

describe('filterChats', () => {
  const chats = [{ title: 'Swap 0.1 ETH to USDC on Base' }, { title: 'Send 20 USDC to mom.near' }, { title: 'Stake NEAR' }]

  it('returns everything for an empty query', () => {
    expect(filterChats(chats, '  ')).toHaveLength(3)
  })

  it('matches every word in any order, ignoring case', () => {
    expect(filterChats(chats, 'usdc SEND').map((c) => c.title)).toEqual(['Send 20 USDC to mom.near'])
    expect(filterChats(chats, 'usdc')).toHaveLength(2)
    expect(filterChats(chats, 'bitcoin')).toHaveLength(0)
  })
})
