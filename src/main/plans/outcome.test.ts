import { describe, expect, it } from 'vitest'
import { nearTransferStep, nearPublicKey } from '../../shared/near/transaction'
import type { PlanCore, PlanSwap } from '../../shared/plan'
import { planOutcome } from './outcome'

const FROM = 'a'.repeat(64)
const base = (extra: Partial<PlanCore>): PlanCore => ({
  hashVersion: 1,
  id: 'plan-1',
  createdBy: 'agent',
  createdAt: '2026-11-13T12:00:00.000Z',
  expiresAt: '2026-11-13T12:30:00.000Z',
  intent: { outcome: 'send', asset: 'NEAR', amount: '1', chain: 'near', to: 'alice.near', toAsset: null, toChain: null },
  recipient: { address: 'alice.near', why: 'typed' },
  summary: 'Send 1 NEAR on near to alice.near',
  steps: [nearTransferStep({ signerId: FROM, publicKey: nearPublicKey(new Uint8Array(32)), receiverId: 'alice.near', deposit: '1500000000000000000000000' })],
  ...extra,
})
const SEND = base({})
const TERMS: PlanSwap = {
  via: '1click',
  depositAddress: 'd'.repeat(64),
  deadline: '2026-11-13T13:30:00.000Z',
  originAsset: 'nep141:wrap.near',
  destinationAsset: 'nep141:base-usdc.omft.near',
  amountIn: '2000000000000000000000000',
  amountOut: '7072681',
  minAmountOut: '7001954',
  sendSymbol: 'NEAR',
  getSymbol: 'USDC',
  getDecimals: '6',
  getChain: 'base',
  recipient: '0x67d29520c6f9579fe4b32dcba346620846ef98d2',
  refundTo: FROM,
  feeBps: '20',
  seconds: '22',
}
const SWAP = base({ swap: TERMS, steps: [] })

describe('how a plan ended', () => {
  it('says a send went through, from the step itself, with its transaction', () => {
    const outcome = planOutcome('plan-1', SEND, 'confirmed', 'Tx1', null)
    expect(outcome?.note).toEqual({ tone: 'ok', title: 'Sent', lines: ['NEAR ran it: 1.5 NEAR to alice.near.'], links: [{ label: 'NEAR transaction', url: 'https://nearblocks.io/txns/Tx1' }] })
    expect(outcome?.forAgent).toBe(
      'Message from Ink, not from the person: plan plan-1 has finished. NEAR confirmed it: 1.5 NEAR to alice.near, transaction Tx1. Tell the person what happened in a sentence or two, with the amounts. Don’t start anything new unless they ask.',
    )
  })

  it('says a send failed, and whether anything was spent', () => {
    expect(planOutcome('plan-1', SEND, 'failed', 'Tx1', null)?.note).toMatchObject({ tone: 'block', lines: ['1.5 NEAR to alice.near: NEAR turned it down or it failed on chain. Any fee already used isn’t returned.'] })
    expect(planOutcome('plan-1', SEND, 'failed', null, null)?.note).toMatchObject({ tone: 'block', lines: ['1.5 NEAR to alice.near: Nothing was sent.'], links: [] })
  })

  it('waits for a swap to finish, not just its deposit', () => {
    expect(planOutcome('plan-1', SWAP, 'confirmed', 'Tx1', null)).toBeNull()
    expect(planOutcome('plan-1', SWAP, 'confirmed', 'Tx1', { stage: 'swapping', got: null, refunded: null, link: null })).toBeNull()
  })

  it('says what a swap paid out and to whom, with both transactions', () => {
    const outcome = planOutcome('plan-1', SWAP, 'confirmed', 'Tx1', { stage: 'done', got: '7.07 USDC', refunded: null, link: 'https://basescan.org/tx/0xabc' })
    expect(outcome?.note).toEqual({
      tone: 'ok',
      title: 'Swap done',
      lines: ['2 NEAR → 7.07 USDC, paid to 0x67d29520c6f9579fe4b32dcba346620846ef98d2 on Base.'],
      links: [
        { label: 'NEAR transaction', url: 'https://nearblocks.io/txns/Tx1' },
        { label: 'Payout', url: 'https://basescan.org/tx/0xabc' },
      ],
    })
    expect(outcome?.forAgent).toContain('NEAR Intents finished the swap: 2 NEAR became 7.07 USDC, paid to 0x67d29520c6f9579fe4b32dcba346620846ef98d2 on Base. Payout: https://basescan.org/tx/0xabc')
  })

  it('says a swap was refunded, failed, or went unanswered, and a deposit that never went', () => {
    expect(planOutcome('plan-1', SWAP, 'confirmed', 'Tx1', { stage: 'refunded', got: null, refunded: '2 NEAR', link: null })?.note).toMatchObject({ tone: 'info', title: 'Swap refunded' })
    expect(planOutcome('plan-1', SWAP, 'confirmed', 'Tx1', { stage: 'failed', got: null, refunded: null, link: null })?.note).toMatchObject({ tone: 'block', title: 'Swap failed' })
    expect(planOutcome('plan-1', SWAP, 'confirmed', 'Tx1', { stage: 'unknown', got: null, refunded: null, link: null })?.note).toMatchObject({ tone: 'info', title: 'Swap still open' })
    expect(planOutcome('plan-1', SWAP, 'failed', null, null)?.note).toMatchObject({ tone: 'block', title: 'Swap not sent' })
  })

  it('says nothing of a plan still on its way, or cancelled', () => {
    for (const status of ['awaiting_review', 'approved', 'signing', 'submitted', 'cancelled', 'expired'] as const) expect(planOutcome('plan-1', SEND, status, null, null)).toBeNull()
  })
})
