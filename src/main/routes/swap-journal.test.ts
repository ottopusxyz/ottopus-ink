import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlanSwap } from '../../shared/plan'
import type { SecretBox } from '../external/sign-ins'
import { createSwapJournal, JOURNAL_KEEP, JOURNAL_MAX_AGE_MS, type JournalEntry } from './swap-journal'
import { createSwapTracker } from './swap-tracker'

/** Stands in for the OS keyring: reversible, and not plain JSON on disk. */
const box: SecretBox = { canKeep: () => true, seal: (text) => Buffer.from(text).reverse(), open: (data) => Buffer.from(data).reverse().toString() }
const noKeyring: SecretBox = { canKeep: () => false, seal: () => Buffer.alloc(0), open: () => '' }

const SWAP: PlanSwap = {
  via: '1click',
  depositAddress: 'd'.repeat(64),
  deadline: '2026-11-13T13:00:00.000Z',
  originAsset: 'nep141:wrap.near',
  destinationAsset: 'nep141:base-usdc.omft.near',
  amountIn: '2000000000000000000000000',
  amountOut: '7072681',
  minAmountOut: '7001954',
  sendSymbol: 'NEAR',
  getSymbol: 'USDC',
  getDecimals: '6',
  getChain: 'base',
  recipient: '0x1111111111111111111111111111111111111111',
  refundTo: 'a'.repeat(64),
  feeBps: '20',
  seconds: '22',
}
const NOW = Date.parse('2026-11-13T12:00:00Z')
const entry = (planId: string, extra: Partial<JournalEntry> = {}): JournalEntry => ({ planId, swap: SWAP, txHash: 'Tx1', startedAt: NOW, progress: null, ...extra })

const dirs: string[] = []
const fileIn = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ink-swaps-'))
  dirs.push(dir)
  return join(dir, 'swaps.bin')
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the swap journal', () => {
  it('keeps swaps sealed across restarts, newest first, with where each stood', () => {
    const file = fileIn()
    const journal = createSwapJournal({ file, box, now: () => NOW })
    journal.put(entry('one'))
    journal.put(entry('two'))
    journal.update('one', { stage: 'done', got: '7.07 USDC', refunded: null, link: 'https://basescan.org/tx/0xabc' })
    expect(readFileSync(file).toString()).not.toContain('one')
    const reopened = createSwapJournal({ file, box, now: () => NOW })
    expect(reopened.list().map((kept) => [kept.planId, kept.progress?.stage ?? null])).toEqual([
      ['two', null],
      ['one', 'done'],
    ])
  })

  it('keeps the newest few, and drops old ones and anything not in its own shape', () => {
    const file = fileIn()
    const journal = createSwapJournal({ file, box, now: () => NOW })
    for (let i = 0; i < JOURNAL_KEEP + 3; i++) journal.put(entry(`plan-${i}`))
    expect(journal.list()).toHaveLength(JOURNAL_KEEP)
    expect(createSwapJournal({ file, box, now: () => NOW + JOURNAL_MAX_AGE_MS }).list()).toEqual([])
    writeFileSync(file, box.seal(JSON.stringify([entry('ok'), { planId: 'bad', swap: {} }, { ...entry('link'), progress: { stage: 'done', got: null, refunded: null, link: 'javascript:x' } }])))
    expect(createSwapJournal({ file, box, now: () => NOW }).list().map((kept) => kept.planId)).toEqual(['ok'])
  })

  it('keeps a swap paid from the Intents balance, and drops one claiming to pay from anywhere else', () => {
    const file = fileIn()
    const journal = createSwapJournal({ file, box, now: () => NOW })
    journal.put(entry('p1', { swap: { ...SWAP, payFrom: 'intents', sendSymbol: 'USDC', sendDecimals: '6' } }))
    journal.put(entry('p2', { swap: { ...SWAP, payFrom: 'elsewhere' } as unknown as PlanSwap }))
    journal.put(entry('p3', { swap: { ...SWAP, sendDecimals: 'lots' } }))
    expect(createSwapJournal({ file, box, now: () => NOW }).list().map((kept) => [kept.planId, kept.swap.payFrom])).toEqual([['p1', 'intents']])
  })

  it('keeps nothing on disk without a keyring', () => {
    const file = fileIn()
    const journal = createSwapJournal({ file, box: noKeyring, now: () => NOW })
    journal.put(entry('one'))
    expect(journal.list()).toHaveLength(1)
    expect(createSwapJournal({ file, box: noKeyring, now: () => NOW }).list()).toEqual([])
  })
})

describe('picking swaps up after a restart', () => {
  it('follows again only the ones that hadn’t settled', async () => {
    const journal = createSwapJournal({ file: fileIn(), box, now: () => NOW })
    journal.put(entry('settled', { progress: { stage: 'done', got: '1 USDC', refunded: null, link: null } }))
    journal.put(entry('open', { progress: { stage: 'swapping', got: null, refunded: null, link: null } }))
    const asked: string[] = []
    const tracker = createSwapTracker({
      journal,
      submit: async () => null,
      status: async (address) => (asked.push(address), { stage: 'SUCCESS', amountOut: 7_000_000n, payoutTx: null, refunded: null }),
      onUpdate: () => {},
      now: () => NOW,
      wait: async () => {},
    })
    tracker.resume()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(asked).toEqual([SWAP.depositAddress])
    expect(tracker.get('open')).toMatchObject({ stage: 'done', got: '7 USDC' })
    expect(tracker.recent().map((kept) => [kept.planId, kept.progress?.stage])).toEqual([
      ['open', 'done'],
      ['settled', 'done'],
    ])
  })
})
