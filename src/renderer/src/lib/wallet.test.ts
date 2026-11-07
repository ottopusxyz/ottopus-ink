import { describe, expect, it } from 'vitest'
import { ACCOUNT_CHAINS } from '../../../shared/accounts'
import type { VaultFailure } from '../../../shared/vault'
import { qrShape } from './qr'
import { addressParts, CHAIN_INFO, passwordProblem, phraseProblem, phraseWords, vaultMessage, wrongAnswers } from './wallet'

describe('wallet copy', () => {
  it('describes every chain Ink holds a key for', () => {
    for (const chain of ACCOUNT_CHAINS) expect(CHAIN_INFO[chain].name.length).toBeGreaterThan(0)
  })

  it('has a message for every failure', () => {
    const reasons: VaultFailure[] = [
      'bad-input', 'busy', 'exists', 'no-vault', 'nothing-pending', 'weak-password', 'invalid-words', 'backup-mismatch',
      'wrong-password', 'damaged', 'keyring-unavailable', 'locked-meanwhile', 'write-failed', 'signer-stopped', 'locked',
    ]
    for (const reason of reasons) expect(vaultMessage(reason)).toMatch(/\.$/)
  })
})

describe('passwordProblem', () => {
  it('wants 12 characters, counted as the signer counts them', () => {
    expect(passwordProblem('short', 'short')).toMatch(/at least 12/)
    expect(passwordProblem('🐙'.repeat(11), '🐙'.repeat(11))).toMatch(/has 11/)
    expect(passwordProblem('🐙'.repeat(12), '🐙'.repeat(12))).toBeNull()
  })

  it('wants the two to match', () => {
    expect(passwordProblem('a long enough password', 'a long enough passw0rd')).toMatch(/don’t match/)
    expect(passwordProblem('a long enough password', 'a long enough password')).toBeNull()
  })

  it('refuses one longer than the signer takes', () => {
    expect(passwordProblem('x'.repeat(1025), 'x'.repeat(1025))).toMatch(/at most/)
  })
})

describe('typed phrases', () => {
  it('splits on any whitespace and forgives capitals', () => {
    expect(phraseWords('  Apple\tbanana \n CHERRY ')).toEqual(['apple', 'banana', 'cherry'])
  })

  it('only counts words: whether they are a real phrase is the signer’s call', () => {
    expect(phraseProblem('word '.repeat(11))).toMatch(/This has 11/)
    expect(phraseProblem('word '.repeat(12))).toBeNull()
    expect(phraseProblem('word '.repeat(24))).toBeNull()
    expect(phraseProblem('')).toMatch(/This has 0/)
  })

  it('finds the backup words typed wrong', () => {
    const words = ['ab', 'cd', 'ef', 'gh']
    expect(wrongAnswers(words, { 1: ' CD ', 3: 'gh' })).toEqual([])
    expect(wrongAnswers(words, { 1: 'cd', 3: 'ef' })).toEqual([3])
    expect(wrongAnswers(words, { 0: '' })).toEqual([0])
  })
})

describe('addressParts', () => {
  it('keeps every character, with the start and end apart', () => {
    const address = 'bc1qg6ucjz7kgdedam7v5yarecy54uqw82yym06z3q'
    const { start, middle, end } = addressParts(address)
    expect([start, end]).toEqual(['bc1qg6', 'm06z3q'])
    expect(start + middle + end).toBe(address)
  })

  it('leaves a short value whole', () => {
    expect(addressParts('abc')).toEqual({ start: 'abc', middle: '', end: '' })
  })
})

describe('qrShape', () => {
  it('draws a square code with a quiet zone, and more modules for a longer address', () => {
    const short = qrShape('0xBbEC2620Cb01adae3f96e1fa39f997f06BFb7Ca0')
    const long = qrShape('06b66cee83c72cf7462ac756b159664732607df5bf254e589426b7e4b4f9d60d')
    expect(short.size).toBeGreaterThanOrEqual(21 + 8)
    expect(long.size).toBeGreaterThan(short.size)
    expect(short.path).toMatch(/^M\d/)
    // The quiet zone: nothing is drawn in the first four rows or columns.
    for (const [, x, y] of short.path.matchAll(/M(\d+) (\d+)/g)) {
      expect(Number(x)).toBeGreaterThanOrEqual(4)
      expect(Number(y)).toBeGreaterThanOrEqual(4)
    }
  })

  it('is the same every time for the same text', () => {
    expect(qrShape('abc')).toEqual(qrShape('abc'))
  })
})
