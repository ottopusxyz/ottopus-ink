import { describe, expect, it } from 'vitest'
import { ACCOUNT_CHAIN_MARK, capStack, chainBadge } from './logos'

describe('a token’s chain badge', () => {
  it('leaves it off on the token’s home chain', () => {
    expect(chainBadge('NEAR', 'near')).toBeNull()
    expect(chainBadge('SOL', 'solana')).toBeNull()
    expect(chainBadge('btc', 'Bitcoin')).toBeNull()
    expect(chainBadge('ETH', 'base')).toBeNull()
  })

  it('shows the chain when the token lives elsewhere', () => {
    expect(chainBadge('USDC', 'base')).toBe('base')
    expect(chainBadge('USDT', 'tron')).toBe('tron')
    expect(chainBadge('ETH', 'polygon')).toBe('polygon')
    expect(chainBadge('NEAR', 'ethereum')).toBe('ethereum')
  })

  it('shows a known chain under a token it has no mark for, and nothing for an unknown chain', () => {
    expect(chainBadge('DOGE', 'near')).toBe('near')
    expect(chainBadge('USDC', 'zksync')).toBeNull()
    expect(chainBadge('USDC', null)).toBeNull()
  })
})

describe('a row of marks', () => {
  it('keeps three and counts the rest', () => {
    expect(capStack([1, 2, 3, 4, 5, 6, 7])).toEqual({ shown: [1, 2, 3], more: 4 })
    expect(capStack([1, 2], 3)).toEqual({ shown: [1, 2], more: 0 })
    expect(capStack([1, 2, 3, 4], 2)).toEqual({ shown: [1, 2], more: 2 })
  })

  it('has a mark for every account chain', () => {
    expect(Object.values(ACCOUNT_CHAIN_MARK)).toEqual(['near', 'ethereum', 'solana', 'bitcoin', 'tron', 'sui', 'aptos'])
  })
})
