import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DepositProgress } from '../../shared/ipc'
import type { SecretBox } from '../external/sign-ins'
import { createDepositJournal } from './deposit-journal'
import { depositEnding } from './deposit-note'
import { BRIDGE_POLL_MS, createDepositWatcher, REFUND_WAIT_MS, WATCH_MS, type WatchAsk, type WatchEntry } from './deposit-watch'
import type { SwapReport, SwapStage } from '../routes/one-click'

const NEAR = 'a'.repeat(64)
const USDC_ID = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near'
const TX_OLD = '0x1000000000000000000000000000000000000000000000000000000000000001'
const TX_NEW = '0x4f2a000000000000000000000000000000000000000000000000000000091c0'
const NOW = Date.parse('2026-11-13T12:00:00Z')
// The card's address closes three days on.
const CLOSES = NOW + 3 * 24 * 60 * 60_000

const INTENTS: WatchAsk = {
  owner: 'chat-a',
  historyId: null,
  bridge: 'eth:8453',
  assetIds: [USDC_ID],
  zerion: 'base',
  deposit: { id: 'd1', kind: 'intents', chain: 'base', chainName: 'Base', mark: 'base', asset: 'USDC', icon: null, amount: '25', address: '0x8f436D184823B77188DE973322278686c3780C2c', memo: null, min: '1', account: NEAR, closes: CLOSES, why: null },
}
const OWN: WatchAsk = {
  ...INTENTS,
  bridge: null,
  assetIds: [],
  deposit: { ...INTENTS.deposit, id: 'd2', kind: 'own', asset: 'DEGEN', address: '0x1111111111111111111111111111111111111111', min: null, account: null, closes: null, why: 'not-in-intents' },
}

/** 1Click's status for the card's address. */
const report = (stage: SwapStage, deposited: string | null = null, depositTx: string | null = null): SwapReport => ({ stage, amountOut: null, payoutTx: null, refunded: null, deposited, depositTx })

/** A watcher whose 1Click answers each look from a script, one answer a look, the last repeated. */
function setup({ statuses = [] as (SwapReport | null)[], balances = [] as bigint[] } = {}) {
  let clock = NOW
  let looks = 0
  let reads = 0
  const updates: { id: string; stage: DepositProgress['stage']; got: string | null; before: DepositProgress['stage'] }[] = []
  const watcher = createDepositWatcher({
    status: async () => statuses[Math.min(looks++, statuses.length - 1)] ?? null,
    balance: async () => {
      const raw = balances[Math.min(reads++, balances.length - 1)]
      return raw === undefined ? null : { raw, decimals: 18 }
    },
    onUpdate: (entry, before) => updates.push({ id: entry.deposit.id, stage: entry.deposit.progress.stage, got: entry.deposit.progress.got, before }),
    now: () => clock,
    wait: async (ms) => {
      clock += ms
      // Lets the test see each step, and bounds a loop that never settles.
      if (clock - NOW > 4 * WATCH_MS) throw new Error('looped past four days')
    },
  })
  return { watcher, updates, looks: () => looks }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('watching NEAR Intents’ deposit address', () => {
  it('follows 1Click’s status for the card’s address until the deposit is credited', async () => {
    const { watcher, updates } = setup({
      statuses: [report('PENDING_DEPOSIT'), null, report('KNOWN_DEPOSIT_TX', '25', TX_NEW), report('PROCESSING', '25', TX_NEW), report('SUCCESS', '25', TX_NEW)],
    })
    const entry = watcher.watch(INTENTS)
    expect(entry.deposit.progress).toMatchObject({ stage: 'watching', until: NOW + WATCH_MS })
    await flush()
    expect(updates.map(({ stage, got, before }) => [stage, got, before])).toEqual([
      ['seen', '25 USDC', 'watching'],
      ['credited', '25 USDC', 'seen'],
    ])
    expect(watcher.get('d1')?.deposit.progress).toMatchObject({ stage: 'credited', tx: TX_NEW, link: `https://basescan.org/tx/${TX_NEW}` })
  })

  it('says a deposit under the minimum waits for the rest, and follows it past the address’s close to its refund', async () => {
    const { watcher, updates } = setup({ statuses: [report('PENDING_DEPOSIT'), report('INCOMPLETE_DEPOSIT', '0.05', TX_NEW)] })
    watcher.watch(INTENTS)
    await flush()
    // Watched past the day, until a while after the address closes, since 1Click only refunds then.
    expect(updates.map(({ stage, got }) => [stage, got])).toEqual([
      ['short', '0.05 USDC'],
      ['stopped', '0.05 USDC'],
    ])
    expect(watcher.get('d1')?.deposit.progress).toMatchObject({ stage: 'stopped', until: CLOSES + REFUND_WAIT_MS })
  })

  it('says a refund went into the Intents balance, apart from a deposit that failed', async () => {
    const refunded = setup({ statuses: [report('INCOMPLETE_DEPOSIT', '0.05', TX_NEW), report('REFUNDED', '0.05', TX_NEW)] })
    refunded.watcher.watch(INTENTS)
    await flush()
    expect(refunded.updates.map(({ stage }) => stage)).toEqual(['short', 'refunded'])
    const failed = setup({ statuses: [report('PROCESSING', '25', TX_NEW), report('FAILED', '25', TX_NEW)] })
    failed.watcher.watch(INTENTS)
    await flush()
    expect(failed.updates.map(({ stage }) => stage)).toEqual(['seen', 'failed'])
  })

  it('asks after a memo address with its memo, since a shared address isn’t found without it', async () => {
    const asked: (string | null)[] = []
    const watcher = createDepositWatcher({
      status: async (_address, memo) => {
        asked.push(memo)
        return report('SUCCESS', '30', TX_NEW)
      },
      balance: async () => null,
      onUpdate: () => undefined,
      now: () => NOW,
      wait: async () => undefined,
    })
    watcher.watch({ ...INTENTS, deposit: { ...INTENTS.deposit, chain: 'stellar', chainName: 'Stellar', asset: 'XLM', address: 'GDJ4JZXZELZD737NVFORH4PSSQDWFDZTKW3AIDKHYQG23ZXBPDGGQBJK', memo: '245055336' } })
    await flush()
    expect(asked).toEqual(['245055336'])
  })

  it('stops after a day with nothing, can watch again, and gives one card to a chat asking twice', async () => {
    const { watcher, updates, looks } = setup({ statuses: [report('PENDING_DEPOSIT')] })
    const first = watcher.watch(INTENTS)
    expect(watcher.watch({ ...INTENTS, deposit: { ...INTENTS.deposit, id: 'd9' } })).toBe(first)
    await flush()
    expect(updates.at(-1)).toMatchObject({ stage: 'stopped', before: 'watching' })
    // Every look a poll apart, for a day.
    expect(looks()).toBe(Math.floor(WATCH_MS / BRIDGE_POLL_MS) + 1)
    // Another chat gets its own card.
    expect(watcher.watch({ ...INTENTS, owner: 'chat-b', deposit: { ...INTENTS.deposit, id: 'd3' } }).deposit.id).toBe('d3')
    expect(watcher.again('d1')?.deposit.progress.stage).toBe('watching')
    expect(watcher.again('nope')).toBeNull()
  })
})

describe('watching the wallet’s own address', () => {
  it('reads the balance first, then says what arrived once it goes up', async () => {
    const { watcher, updates } = setup({ balances: [10n ** 18n, 10n ** 18n, 13n * 10n ** 18n] })
    watcher.watch(OWN)
    await flush()
    expect(updates.map(({ stage, got }) => [stage, got])).toEqual([['credited', '12 DEGEN']])
  })

  it('doesn’t watch a chain Ink reads no balances for', () => {
    const { watcher } = setup()
    expect(watcher.watch({ ...OWN, zerion: null }).deposit.progress.stage).toBe('unwatched')
  })
})

describe('what Ink says when a deposit ends', () => {
  const ended = (progress: Partial<DepositProgress>, ask: WatchAsk = INTENTS) => depositEnding({ ...ask.deposit, progress: { stage: 'credited', got: '25 USDC', tx: TX_NEW, link: null, until: NOW, ...progress } })

  it('tells the person and the agent it landed, with the transaction', () => {
    expect(ended({})).toEqual({
      note: { tone: 'ok', title: '25 USDC arrived', lines: ['25 USDC sent on Base is in your Intents balance.'], links: [{ label: 'View on BaseScan', url: `https://basescan.org/tx/${TX_NEW}` }] },
      forAgent: `Ink: the deposit landed. 25 USDC sent on Base is now in the wallet’s NEAR Intents balance (account ${NEAR}), transaction ${TX_NEW}. It can be swapped or sent from there.`,
    })
    expect(ended({ got: '12 DEGEN', tx: null }, OWN)?.note).toMatchObject({ title: '12 DEGEN arrived', lines: ['Your Base balance went up by 12 DEGEN.'], links: [] })
  })

  it('says a refund is in the Intents balance, plainly when it wasn’t credited, and nothing for other stages', () => {
    expect(ended({ stage: 'refunded', got: '0.05 USDC' })).toEqual({
      note: { tone: 'info', title: '0.05 USDC came back', lines: ['NEAR Intents didn’t take 0.05 USDC sent on Base and refunded it into your Intents balance. It was likely under its 1 USDC minimum.'], links: [{ label: 'View on BaseScan', url: `https://basescan.org/tx/${TX_NEW}` }] },
      forAgent: `Ink: NEAR Intents refunded the deposit of 0.05 USDC on Base (transaction ${TX_NEW}) into the wallet’s NEAR Intents balance (account ${NEAR}). It was likely under its 1 USDC minimum. It can be sent or swapped from there.`,
    })
    expect(ended({ stage: 'failed', got: '0.5 USDC' })?.note).toMatchObject({ tone: 'block', title: '0.5 USDC wasn’t credited' })
    expect(ended({ stage: 'seen' })).toBeNull()
    expect(ended({ stage: 'short' })).toBeNull()
    expect(ended({ stage: 'stopped' })).toBeNull()
  })
})

describe('keeping watches across restarts', () => {
  const box: SecretBox = { canKeep: () => true, seal: (text) => Buffer.from(text).reverse(), open: (data) => Buffer.from(data).reverse().toString() }
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  const fileIn = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ink-deposits-'))
    dirs.push(dir)
    return join(dir, 'deposits.bin')
  }
  const entry = (id: string, stage: DepositProgress['stage'] = 'watching'): WatchEntry => ({
    ...INTENTS,
    deposit: { ...INTENTS.deposit, id, progress: { stage, got: null, tx: null, link: null, until: NOW + WATCH_MS } },
    // A watch saved before Ink moved to 1Click still reads.
    before: [TX_OLD],
    baseline: null,
    startedAt: NOW,
  })

  it('keeps them sealed, and drops anything not in the shape it writes', () => {
    const file = fileIn()
    const journal = createDepositJournal({ file, box, now: () => NOW })
    journal.put(entry('d1'))
    journal.put(entry('d2'))
    journal.put({ ...entry('d1', 'credited') })
    expect(readFileSync(file).toString()).not.toContain('USDC')
    const again = createDepositJournal({ file, box, now: () => NOW })
    expect(again.list().map((each) => [each.deposit.id, each.deposit.progress.stage])).toEqual([
      ['d2', 'watching'],
      ['d1', 'credited'],
    ])
  })

  it('reads a card kept before cards had a close time as having none', () => {
    const file = fileIn()
    const older: Record<string, unknown> = { ...INTENTS.deposit, id: 'd1', progress: { stage: 'short', got: '0.05 USDC', tx: null, link: null, until: NOW + WATCH_MS } }
    delete older.closes
    const kept = { ...entry('d1', 'short'), deposit: older }
    writeFileSync(file, box.seal(JSON.stringify([kept])))
    expect(createDepositJournal({ file, box, now: () => NOW }).list().map((each) => [each.deposit.progress.stage, each.deposit.closes])).toEqual([['short', null]])
  })

  it('picks up a watch a restart cut off', async () => {
    const file = fileIn()
    createDepositJournal({ file, box, now: () => NOW }).put(entry('d1'))
    const updates: string[] = []
    const watcher = createDepositWatcher({
      status: async () => report('SUCCESS', '25', TX_NEW),
      balance: async () => null,
      onUpdate: (kept) => updates.push(`${kept.deposit.id} ${kept.deposit.progress.stage}`),
      journal: createDepositJournal({ file, box, now: () => NOW }),
      now: () => NOW,
      wait: async () => undefined,
    })
    watcher.resume()
    await flush()
    expect(updates).toEqual(['d1 credited'])
  })
})
