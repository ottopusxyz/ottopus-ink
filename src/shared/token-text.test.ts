import { describe, expect, it } from 'vitest'
import { cleanSymbol, formatUnits, usdValue } from './token-text'

describe('a token symbol fit to show', () => {
  it('keeps one short word', () => {
    for (const symbol of ['NEAR', 'USDt', 'wNEAR', 'stNEAR', '$NEAR', 'USDC.e', 'NEAR-LP', '404']) expect(cleanSymbol(symbol)).toBe(symbol)
    expect(cleanSymbol('  NEAR ')).toBe('NEAR')
  })

  it('refuses sentences, links, other scripts, and anything long or empty', () => {
    for (const symbol of ['You won 500 NEAR!', 'Claim at https://example.test', 'N@6', '🎉NEAR', 'NEАR', '暗金', '', 'A'.repeat(17), 'two words'])
      expect(cleanSymbol(symbol)).toBeNull()
    expect(cleanSymbol(5)).toBeNull()
    expect(cleanSymbol(null)).toBeNull()
  })
})

describe('token amounts', () => {
  it('reads a smallest-unit amount at the token’s decimals, exactly', () => {
    expect(formatUnits(1_500_000n, 6)).toBe('1.5')
    expect(formatUnits(2_000_000n, 6)).toBe('2')
    expect(formatUnits(1n, 24)).toBe('0.000000000000000000000001')
    expect(formatUnits(42n, 0)).toBe('42')
    expect(formatUnits(-5n, 1)).toBe('-0.5')
  })

  it('puts a dollar value on an amount', () => {
    expect(usdValue(2_500_000n, 6, 1)).toBeCloseTo(2.5)
    expect(usdValue(10n ** 24n, 24, 3.68)).toBeCloseTo(3.68)
  })
})
