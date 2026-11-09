import { describe, expect, it } from 'vitest'
import { nearAccountKind } from './account-id'
import { formatNear, parseNear, YOCTO_PER_NEAR } from './units'

describe('NEAR amounts', () => {
  it('turns decimals into exact yoctoNEAR', () => {
    expect(parseNear('1')).toBe(YOCTO_PER_NEAR)
    expect(parseNear('1.5')).toBe(1_500_000_000_000_000_000_000_000n)
    expect(parseNear('0.000000000000000000000001')).toBe(1n)
    expect(parseNear('0')).toBe(0n)
    // Past 2^53, where a float would round.
    expect(parseNear('123456789.123456789123456789123456')).toBe(123_456_789_123_456_789_123_456_789_123_456n)
  })

  it('refuses what can’t be sent exactly, or isn’t a plain decimal', () => {
    for (const bad of ['0.0000000000000000000000001', '1e3', '-1', '01', '1.', '.5', ' 1', '1,5', '']) expect(parseNear(bad)).toBeNull()
  })

  it('writes yoctoNEAR back as NEAR with no trailing zeros', () => {
    expect(formatNear(1_500_000_000_000_000_000_000_000n)).toBe('1.5')
    expect(formatNear(YOCTO_PER_NEAR * 3n)).toBe('3')
    expect(formatNear(1n)).toBe('0.000000000000000000000001')
    expect(formatNear(0n)).toBe('0')
    expect(formatNear(-1n)).toBe('-0.000000000000000000000001')
    for (const amount of ['1', '0.25', '1234.000000000000000000000001']) expect(formatNear(parseNear(amount)!)).toBe(amount)
  })
})

describe('NEAR account ids', () => {
  it('tells implicit, Ethereum-implicit and named accounts apart', () => {
    expect(nearAccountKind('a'.repeat(64))).toBe('implicit')
    expect(nearAccountKind('06b66cee83c72cf7462ac756b159664732607df5bf254e589426b7e4b4f9d60d')).toBe('implicit')
    expect(nearAccountKind('0x' + 'b'.repeat(40))).toBe('eth-implicit')
    for (const named of ['alice.near', 'near', 'a-b_c.d1.near', 'aa', 'intents.near', 'app.alice.near']) expect(nearAccountKind(named)).toBe('named')
  })

  it('refuses what nearcore refuses', () => {
    const bad = [
      'a', // too short
      'a'.repeat(65),
      'Alice.near', // upper case
      'alice..near',
      '.alice',
      'alice.',
      '-alice.near',
      'alice-.near',
      'al--ice.near',
      'al_-ice.near',
      'alice near',
      'alice@near',
      '0x' + 'B'.repeat(40), // NEP-518 ids are lower case
      '',
    ]
    for (const id of bad) expect(nearAccountKind(id), id).toBeNull()
  })

  it('counts a 64-character id as implicit only when it is all hex', () => {
    expect(nearAccountKind('g'.repeat(64))).toBe('named')
  })
})
