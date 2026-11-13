import { describe, expect, it } from 'vitest'
import type { ChatSwap } from '../../shared/ipc'
import type { PlanSwap } from '../../shared/plan'
import type { SwapReport, SwapStage } from './one-click'
import { createSwapTracker, SWAP_FOLLOW_AFTER_DEADLINE_MS, SWAP_POLL_MS } from './swap-tracker'

const DEADLINE = Date.parse('2026-11-13T13:00:00Z')
const SWAP: PlanSwap = {
  via: '1click',
  depositAddress: 'd'.repeat(64),
  deadline: new Date(DEADLINE).toISOString(),
  originAsset: 'nep141:wrap.near',
  destinationAsset: 'nep141:base-usdc.omft.near',
  amountIn: '5000000000000000000000000',
  amountOut: '17400531',
  minAmountOut: '17226525',
  sendSymbol: 'NEAR',
  getSymbol: 'USDC',
  getDecimals: '6',
  getChain: 'base',
  recipient: '0x1111111111111111111111111111111111111111',
  refundTo: 'a'.repeat(64),
  feeBps: '20',
  seconds: '22',
}
const report = (stage: SwapStage, extra: Partial<SwapReport> = {}): SwapReport => ({ stage, amountOut: null, payoutTx: null, refunded: null, ...extra })

function tracker(reports: (SwapReport | null)[], { submitted = report('KNOWN_DEPOSIT_TX') as SwapReport | null, start = DEADLINE - 60_000 } = {}) {
  let time = start
  const told: unknown[] = []
  const asked: string[] = []
  const updates: [string, ChatSwap][] = []
  const waits: number[] = []
  const follow = createSwapTracker({
    submit: async (deposit) => (told.push(deposit), submitted),
    status: async (address) => (asked.push(address), reports.shift() ?? null),
    onUpdate: (id, swap) => updates.push([id, swap]),
    now: () => time,
    wait: async (ms) => {
      waits.push(ms)
      time += ms
    },
  })
  return { follow, told, asked, updates, waits, jump: (ms: number) => (time += ms) }
}

describe('following a swap', () => {
  it('tells 1Click the deposit, then checks until it’s paid out, with what was paid and a link', async () => {
    const { follow, told, asked, updates, waits } = tracker([report('PROCESSING'), report('SUCCESS', { amountOut: 17_400_000n, payoutTx: { hash: '0xabc', explorerUrl: 'https://basescan.org/tx/0xabc' } })])
    expect(await follow.follow('plan-1', SWAP, 'Tx1')).toEqual({ stage: 'done', got: '17.4 USDC', refunded: null, link: 'https://basescan.org/tx/0xabc' })
    expect(told).toEqual([{ txHash: 'Tx1', depositAddress: SWAP.depositAddress, nearSenderAccount: SWAP.refundTo }])
    expect(asked).toEqual([SWAP.depositAddress, SWAP.depositAddress])
    expect(waits).toEqual([SWAP_POLL_MS, SWAP_POLL_MS])
    expect(updates.map(([, swap]) => swap.stage)).toEqual(['deposited', 'swapping', 'done'])
    expect(updates.every(([id]) => id === 'plan-1')).toBe(true)
    expect(follow.get('plan-1')).toMatchObject({ stage: 'done' })
  })

  it('says what came back when the swap is refunded', async () => {
    const { follow } = tracker([report('REFUNDED', { refunded: 5n * 10n ** 24n })])
    expect(await follow.follow('plan-1', SWAP, 'Tx1')).toEqual({ stage: 'refunded', got: null, refunded: '5 NEAR', link: null })
    // From the Intents balance, the token comes back at its own decimals.
    const fromIntents = tracker([report('REFUNDED', { refunded: 25_000_000n })])
    expect(await fromIntents.follow.follow('plan-2', { ...SWAP, payFrom: 'intents', sendSymbol: 'USDC', sendDecimals: '6' }, 'Tx2')).toMatchObject({ stage: 'refunded', refunded: '25 USDC' })
  })

  it('keeps checking through answers it can’t read, and tells the chat only when something moves', async () => {
    const { follow, updates } = tracker([null, report('PENDING_DEPOSIT'), report('PROCESSING'), report('PROCESSING'), report('FAILED')], { submitted: null })
    expect(await follow.follow('plan-1', SWAP, 'Tx1')).toMatchObject({ stage: 'failed' })
    expect(updates.map(([, swap]) => swap.stage)).toEqual(['deposited', 'swapping', 'failed'])
  })

  it('stops checking well past the deposit address’s deadline, and says it doesn’t know', async () => {
    const { follow, updates, waits } = tracker([], { start: DEADLINE + SWAP_FOLLOW_AFTER_DEADLINE_MS - 2 * SWAP_POLL_MS })
    expect(await follow.follow('plan-1', SWAP, 'Tx1')).toMatchObject({ stage: 'unknown' })
    expect(waits.length).toBeLessThanOrEqual(3)
    expect(updates.at(-1)?.[1].stage).toBe('unknown')
  })

  it('knows nothing of a plan it isn’t following', () => {
    expect(tracker([]).follow.get('plan-2')).toBeNull()
  })
})
