import { describe, expect, it } from 'vitest'
import { cleanSymbol, formatUnits, parseUnits, usdValue } from './token-text'

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

  it('reads a decimal amount as the token’s smallest unit, exactly', () => {
    expect(parseUnits('1.5', 6)).toBe(1_500_000n)
    expect(parseUnits('5', 24)).toBe(5n * 10n ** 24n)
    expect(parseUnits('0.000001', 6)).toBe(1n)
    expect(parseUnits('2.50', 1)).toBe(25n)
    expect(parseUnits('0', 8)).toBe(0n)
    expect(parseUnits('7', 0)).toBe(7n)
  })

  it('refuses anything but a plain decimal the token can hold', () => {
    for (const text of ['', '.5', '5.', '-1', '1e6', '1,000', ' 1', '01', '0x10', 'NaN']) expect(parseUnits(text, 6)).toBeNull()
    expect(parseUnits('0.0000001', 6)).toBeNull()
    expect(parseUnits('1.5', 0)).toBeNull()
  })

  it('puts a dollar value on an amount', () => {
    expect(usdValue(2_500_000n, 6, 1)).toBeCloseTo(2.5)
    expect(usdValue(10n ** 24n, 24, 3.68)).toBeCloseTo(3.68)
  })
})
