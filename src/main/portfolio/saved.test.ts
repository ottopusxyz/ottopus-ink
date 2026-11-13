import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Portfolio } from '../../shared/portfolio'
import type { SecretBox } from '../external/sign-ins'
import { createSavedPortfolios, walletKey } from './saved'

/** A stand-in keyring: reversible, and plainly not the text it sealed. */
const box = (canKeep = true): SecretBox => ({
  canKeep: () => canKeep,
  seal: (text) => Buffer.from(`sealed:${Buffer.from(text).toString('base64')}`),
  open: (data) => Buffer.from(data.toString().replace(/^sealed:/, ''), 'base64').toString(),
})

const PORTFOLIO: Portfolio = {
  near: { accountId: 'alice.near', onChain: true, available: '10', staked: '0', storage: '0', pools: [], stakingComplete: true },
  nearPrice: { usd: 4, change24h: null },
  tokens: [],
  zerion: 'off',
  zerionVia: null,
  unread: [],
  unpriced: 0,
  totalUsd: 40,
  readAt: 1_000,
  gaps: [],
}

const ALICE = walletKey({ near: 'alice.near', evm: '0xabc' })

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ink-saved-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('the saved portfolio', () => {
  it('is kept sealed on disk, private to the user, and comes back next run for the same wallet', () => {
    const file = join(dir, 'portfolio.bin')
    createSavedPortfolios({ file, box: box() }).save(ALICE, PORTFOLIO)
    expect(readFileSync(file, 'utf8')).not.toContain('alice.near')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(createSavedPortfolios({ file, box: box() }).get(ALICE)).toEqual(PORTFOLIO)
  })

  it('is never another wallet’s', () => {
    const file = join(dir, 'portfolio.bin')
    const saved = createSavedPortfolios({ file, box: box() })
    saved.save(ALICE, PORTFOLIO)
    expect(saved.get(walletKey({ near: 'bob.near' }))).toBeNull()
    expect(walletKey({ near: 'alice.near', evm: '0xabc' })).toBe(ALICE)
    expect(walletKey({ near: 'alice.near', evm: '0xdef' })).not.toBe(ALICE)
  })

  it('is held for this run only, never on disk, without a keyring', () => {
    const file = join(dir, 'portfolio.bin')
    const saved = createSavedPortfolios({ file, box: box(false) })
    saved.save(ALICE, PORTFOLIO)
    expect(saved.get(ALICE)).toEqual(PORTFOLIO)
    expect(existsSync(file)).toBe(false)
  })

  it('drops a damaged or older file, and is gone once forgotten', () => {
    const file = join(dir, 'portfolio.bin')
    writeFileSync(file, box().seal(JSON.stringify({ wallet: ALICE, portfolio: { total: 5 } })))
    expect(createSavedPortfolios({ file, box: box() }).get(ALICE)).toBeNull()
    writeFileSync(file, 'garbage')
    expect(createSavedPortfolios({ file, box: box() }).get(ALICE)).toBeNull()

    const saved = createSavedPortfolios({ file, box: box() })
    saved.save(ALICE, PORTFOLIO)
    saved.forget()
    expect(saved.get(ALICE)).toBeNull()
    expect(existsSync(file)).toBe(false)
  })
})
