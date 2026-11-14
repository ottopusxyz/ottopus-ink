import { describe, expect, it } from 'vitest'
import { shortAmounts } from './amounts'

describe('amounts cut for a glance', () => {
  it('cuts each long amount in a line and marks it, leaving the rest alone', () => {
    expect(shortAmounts('7.006847573802613 USDT on BNB Chain')).toBe('≈7.0068 USDT on BNB Chain')
    expect(shortAmounts('3.150204 USDC on NEAR')).toBe('≈3.1502 USDC on NEAR')
    expect(shortAmounts('Pay 10 USDC on Solana')).toBe('Pay 10 USDC on Solana')
    expect(shortAmounts('0.5 USDC and 0.0000123456 NEAR')).toBe('0.5 USDC and ≈0.000012 NEAR')
  })

  it('leaves version numbers, short decimals and words with digits as they are', () => {
    expect(shortAmounts('INV-2026-1121, 1.25 USDC')).toBe('INV-2026-1121, 1.25 USDC')
  })
})
