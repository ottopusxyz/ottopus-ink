import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DepositProgress } from '../../shared/ipc'
import type { SecretBox } from '../external/sign-ins'
import { createDepositJournal } from './deposit-journal'
import { depositEnding } from './deposit-note'
import { BRIDGE_POLL_MS, createDepositWatcher, WATCH_MS, type WatchAsk, type WatchEntry } from './deposit-watch'
import type { BridgeDeposit } from './deposits'

const NEAR = 'a'.repeat(64)
const USDC_ID = 'eth:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const TX_OLD = '0x1000000000000000000000000000000000000000000000000000000000000001'
const TX_NEW = '0x4f2a000000000000000000000000000000000000000000000000000000091c0'
const NOW = Date.parse('2026-11-13T12:00:00Z')

const INTENTS: WatchAsk = {
  owner: 'chat-a',
  historyId: null,
  bridge: 'eth:8453',
  assetIds: [USDC_ID],
  zerion: 'base',
  deposit: { id: 'd1', kind: 'intents', chain: 'base', chainName: 'Base', mark: 'base', asset: 'USDC', icon: null, amount: '25', address: '0x8f436D184823B77188DE973322278686c3780C2c', memo: null, min: '1', account: NEAR, why: null },
}
const OWN: WatchAsk = {
  ...INTENTS,
  bridge: null,
  assetIds: [],
  deposit: { ...INTENTS.deposit, id: 'd2', kind: 'own', asset: 'DEGEN', address: '0x1111111111111111111111111111111111111111', min: null, account: null, why: 'not-in-intents' },
}

const deposit = (tx: string, status: BridgeDeposit['status'], amount = 25_000_000n): BridgeDeposit => ({ tx, assetId: USDC_ID, decimals: 6, amount, status })

/** A watcher whose bridge answers each look from a script, one answer a look, the last repeated. */
function setup({ bridge = [] as BridgeDeposit[][], balances = [] as bigint[] } = {}) {
  let clock = NOW
  let looks = 0
  let reads = 0
  const updates: { id: string; stage: DepositProgress['stage']; got: string | null; before: DepositProgress['stage'] }[] = []
  const watcher = createDepositWatcher({
    recent: async () => bridge[Math.min(looks++, bridge.length - 1)] ?? null,
    balance: async () => {
      const raw = balances[Math.min(reads++, balances.length - 1)]
      return raw === undefined ? null : { raw, decimals: 18 }
    },
    onUpdate: (entry, before) => updates.push({ id: entry.deposit.id, stage: entry.deposit.progress.stage, got: entry.deposit.progress.got, before }),
    now: () => clock,
    wait: async (ms) => {
      clock += ms
      // Lets the test see each step, and bounds a loop that never settles.
      if (clock - NOW > 3 * WATCH_MS) throw new Error('looped past three days')
    },
  })
  return { watcher, updates, looks: () => looks }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('watching NEAR Intents’ deposit address', () => {
  it('ignores what was there before, then follows the new deposit until it’s credited', async () => {
    const { watcher, updates } = setup({
      bridge: [[deposit(TX_OLD, 'COMPLETED')], [deposit(TX_OLD, 'COMPLETED')], [deposit(TX_NEW, 'PENDING'), deposit(TX_OLD, 'COMPLETED')], [deposit(TX_NEW, 'CREDITED'), deposit(TX_OLD, 'COMPLETED')]],
    })
    const entry = watcher.watch(INTENTS)
    expect(entry.deposit.progress).toMatchObject({ stage: 'watching', until: NOW + WATCH_MS })
    await flush()
    expect(updates.map(({ stage, got, before }) => [stage, got, before])).toEqual([
      ['seen', '25 USDC', 'watching'],
      ['credited', '25 USDC', 'seen'],
    ])
    expect(watcher.get('d1')?.deposit.progress).toMatchObject({ stage: 'credited', tx: TX_NEW, link: `https://basescan.org/tx/${TX_NEW}` })
    expect(watcher.get('d1')?.before).toEqual([TX_OLD])
  })

  it('says when NEAR Intents didn’t credit it, and ignores other tokens', async () => {
    const other: BridgeDeposit = { ...deposit('0x9999999999999999999999999999999999999999999999999999999999999999', 'COMPLETED'), assetId: 'eth:8453:native' }
    const { watcher, updates } = setup({ bridge: [[], [other], [deposit(TX_NEW, 'FAILED', 500_000n), other]] })
    watcher.watch(INTENTS)
    await flush()
    expect(updates.map(({ stage, got }) => [stage, got])).toEqual([['failed', '0.5 USDC']])
  })

  it('stops after a day with nothing, can watch again, and gives one card to a chat asking twice', async () => {
    const { watcher, updates, looks } = setup({ bridge: [[]] })
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

  it('says plainly when it wasn’t credited, and nothing for other stages', () => {
    expect(ended({ stage: 'failed', got: '0.5 USDC' })?.note).toMatchObject({ tone: 'block', title: '0.5 USDC wasn’t credited' })
    expect(ended({ stage: 'seen' })).toBeNull()
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

  it('picks up a watch a restart cut off', async () => {
    const file = fileIn()
    createDepositJournal({ file, box, now: () => NOW }).put(entry('d1'))
    const updates: string[] = []
    const watcher = createDepositWatcher({
      recent: async () => [deposit(TX_NEW, 'COMPLETED'), deposit(TX_OLD, 'COMPLETED')],
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
