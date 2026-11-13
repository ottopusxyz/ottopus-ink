import { describe, expect, it } from 'vitest'
import type { ChatPlan, ChatSwap } from '../../../shared/ipc'
import { isUnderWay, trackerSteps, trackerSummary } from './plan-tracker'

const SEND: ChatPlan = { id: 'p', status: 'awaiting_review', outcome: 'send', asset: 'NEAR', amount: '1', chain: 'near', to: 'alice.near', toAsset: null, toChain: null }
const SWAP: ChatPlan = { ...SEND, outcome: 'swap', to: null, toAsset: 'USDC', toChain: 'base' }
const states = (plan: ChatPlan) => trackerSteps(plan).map((step) => `${step.label}:${step.state}`)
const swap = (stage: ChatSwap['stage'], extra: Partial<ChatSwap> = {}): ChatSwap => ({ stage, got: null, refunded: null, link: null, ...extra })

describe('the plan tracker', () => {
  it('walks a send from review through signing to NEAR', () => {
    expect(states(SEND)).toEqual(['Review:active', 'Sign:pending', 'On NEAR:pending'])
    expect(states({ ...SEND, status: 'signing' })).toEqual(['Review:done', 'Sign:active', 'On NEAR:pending'])
    expect(states({ ...SEND, status: 'submitted', transactionId: 'Tx1' })).toEqual(['Review:done', 'Sign:done', 'On NEAR:active'])
    const done = trackerSteps({ ...SEND, status: 'confirmed', transactionId: 'Tx1' })
    expect(done.map((step) => step.state)).toEqual(['done', 'done', 'done'])
    expect(done[2]).toMatchObject({ detail: 'Confirmed', link: { label: 'nearblocks', url: 'https://nearblocks.io/txns/Tx1' } })
    expect(trackerSummary({ ...SEND, status: 'confirmed' })).toBe('Sent')
  })

  it('walks a swap on through NEAR Intents to its payout', () => {
    expect(states({ ...SWAP, status: 'confirmed', transactionId: 'Tx1' })).toEqual(['Review:done', 'Sign:done', 'On NEAR:done', 'Swap:active', 'Paid out on Base:pending'])
    expect(trackerSummary({ ...SWAP, status: 'confirmed', swap: swap('swapping') })).toBe('Swapping now')
    const paid = trackerSteps({ ...SWAP, status: 'confirmed', transactionId: 'Tx1', swap: swap('done', { got: '7.07 USDC', link: 'https://basescan.org/tx/0xabc' }) })
    expect(paid.map((step) => step.state)).toEqual(['done', 'done', 'done', 'done', 'done'])
    expect(paid[4]).toMatchObject({ label: 'Paid out on Base', detail: '7.07 USDC', link: { url: 'https://basescan.org/tx/0xabc' } })
    expect(trackerSummary({ ...SWAP, status: 'confirmed', swap: swap('done') })).toBe('Done')
  })

  it('shows a refund or a failed swap as such', () => {
    expect(states({ ...SWAP, status: 'confirmed', swap: swap('refunded', { refunded: '2 NEAR' }) }).slice(3)).toEqual(['Swap:failed', 'Paid out on Base:failed'])
    expect(trackerSummary({ ...SWAP, status: 'confirmed', swap: swap('refunded') })).toBe('Refunded')
    expect(trackerSummary({ ...SWAP, status: 'confirmed', swap: swap('failed') })).toBe('Couldn’t finish')
  })

  it('shows where a plan stopped: unsigned, turned down by NEAR, or never approved', () => {
    expect(states({ ...SEND, status: 'failed' })).toEqual(['Review:done', 'Sign:failed', 'On NEAR:pending'])
    expect(states({ ...SEND, status: 'failed', transactionId: 'Tx1' })).toEqual(['Review:done', 'Sign:done', 'On NEAR:failed'])
    expect(states({ ...SWAP, status: 'cancelled' })).toEqual(['Review:failed', 'Sign:pending', 'On NEAR:pending', 'Swap:pending', 'Paid out on Base:pending'])
    expect(trackerSummary({ ...SEND, status: 'expired' })).toBe('Expired')
    expect(trackerSummary({ ...SEND, status: 'draft' })).toBe('Ink can’t send this yet')
  })

  it('is on show only while the plan is on its way, and steps aside once it’s finished', () => {
    for (const status of ['awaiting_review', 'approved', 'signing', 'submitted'] as const) expect(isUnderWay({ ...SEND, status }), status).toBe(true)
    for (const status of ['draft', 'confirmed', 'failed', 'cancelled', 'expired', 'blocked'] as const) expect(isUnderWay({ ...SEND, status }), status).toBe(false)
    // A swap goes on after its deposit, until NEAR Intents settles it.
    expect(isUnderWay({ ...SWAP, status: 'confirmed' })).toBe(true)
    expect(isUnderWay({ ...SWAP, status: 'confirmed', swap: swap('swapping') })).toBe(true)
    for (const stage of ['done', 'refunded', 'failed', 'unknown'] as const) expect(isUnderWay({ ...SWAP, status: 'confirmed', swap: swap(stage) }), stage).toBe(false)
  })
})
