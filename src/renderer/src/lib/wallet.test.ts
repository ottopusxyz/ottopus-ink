import { describe, expect, it } from 'vitest'
import { ACCOUNT_CHAINS } from '../../../shared/accounts'
import type { VaultFailure } from '../../../shared/vault'
import { qrShape } from './qr'
import { addressParts, autoLockNote, CHAIN_INFO, passwordProblem, passwordStrength, phraseLost, phraseProblem, phraseWords, typedAnswers, vaultMessage, wrongAnswers } from './wallet'

describe('wallet copy', () => {
  it('names every chain Ink holds a key for, each under its own chain', () => {
    expect(Object.fromEntries(ACCOUNT_CHAINS.map((chain) => [chain, CHAIN_INFO[chain].name]))).toEqual({
      near: 'NEAR',
      evm: 'Ethereum and EVM chains',
      solana: 'Solana',
      bitcoin: 'Bitcoin',
      tron: 'Tron',
      sui: 'Sui',
      aptos: 'Aptos',
    })
  })

  it('puts each chain’s warning under that chain', () => {
    expect(CHAIN_INFO.near.note).toContain('NEAR Intents account')
    expect(CHAIN_INFO.evm.note).toContain('Base, Ethereum, Arbitrum')
    expect(CHAIN_INFO.bitcoin.note).toContain('Send bitcoin only')
    expect(CHAIN_INFO.tron.note).toContain('TRX')
    expect(CHAIN_INFO.aptos.note).toContain('Aptos')
    expect(CHAIN_INFO.solana.note).toContain('SOL')
    expect(CHAIN_INFO.sui.note).toContain('SUI')
  })

  it('has a message for every failure', () => {
    const reasons: VaultFailure[] = [
      'bad-input', 'busy', 'exists', 'no-vault', 'nothing-pending', 'weak-password', 'invalid-words', 'backup-mismatch',
      'wrong-password', 'damaged', 'keyring-unavailable', 'locked-meanwhile', 'write-failed', 'signer-stopped', 'locked',
      'plan-mismatch', 'refused',
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

describe('passwordStrength', () => {
  it('fills the meter by length, and counts down to the minimum', () => {
    expect(passwordStrength('')).toMatchObject({ bars: 0, ok: false })
    expect(passwordStrength('abc')).toMatchObject({ bars: 1, ok: false, text: '9 more characters to go.' })
    expect(passwordStrength('a'.repeat(11))).toMatchObject({ bars: 2, text: '1 more character to go.' })
    expect(passwordStrength('a'.repeat(12))).toMatchObject({ bars: 3, ok: true })
    expect(passwordStrength('a'.repeat(20))).toMatchObject({ bars: 4, ok: true })
  })

  it('agrees with passwordProblem on the minimum', () => {
    expect(passwordStrength('🐙'.repeat(12)).ok).toBe(passwordProblem('🐙'.repeat(12), '🐙'.repeat(12)) === null)
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

  it('sends the signer what was typed for each asked-for word, not the phrase’s own words', () => {
    expect(typedAnswers([1, 3], { 1: ' CD ', 3: 'xyz', 0: 'ignored' })).toEqual([
      { index: 1, word: ' CD ' },
      { index: 3, word: 'xyz' },
    ])
    expect(typedAnswers([2], {})).toEqual([{ index: 2, word: '' }])
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

describe('phraseLost', () => {
  it('is true whenever a step that relies on the phrase finds none waiting', () => {
    for (const step of ['words', 'check', 'password']) {
      expect(phraseLost(false, step)).toBe(true)
      expect(phraseLost(true, step)).toBe(false)
    }
    // Back at the start or restoring, nothing on screen depends on it.
    for (const step of ['welcome', 'restore']) {
      expect(phraseLost(false, step)).toBe(false)
      expect(phraseLost(true, step)).toBe(false)
    }
  })
})

describe('autoLockNote', () => {
  it('promises a lock on screen lock only where Electron reports one', () => {
    const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Electron/45.2.1 Safari/537.36'
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Electron/45.2.1 Safari/537.36'
    const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Electron/45.2.1 Safari/537.36'
    expect(autoLockNote(linux)).not.toContain('screen')
    expect(autoLockNote(linux)).toContain('sleeps')
    for (const agent of [mac, windows]) expect(autoLockNote(agent)).toContain('its screen locks')
  })
})
