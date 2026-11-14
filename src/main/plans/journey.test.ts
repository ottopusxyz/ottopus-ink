import { hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import { evmTransferStep } from '../../shared/evm/transaction'
import type { ChatSwap } from '../../shared/ipc'
import { nearCallStep } from '../../shared/near/calls'
import { nearPublicKey } from '../../shared/near/transaction'
import type { PlanCore, PlanStatus, PlanSwap } from '../../shared/plan'
import { journeyOf, type StepTx } from './journey'

const NEAR_ID = 'a'.repeat(64)
const EVM = '0xBbEC2620Cb01adae3f96e1fa39f997f06BFb7Ca0'
const SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const near = (token: string, amount: bigint) =>
  nearCallStep({ signerId: NEAR_ID, publicKey: nearPublicKey(hexToBytes(NEAR_ID)), receiverId: 'intents.near', calls: [{ method: 'mt_transfer', receiverId: 'd'.repeat(64), tokenId: token, amount }] })
const swap = (extra: Partial<PlanSwap>): PlanSwap => ({
  via: '1click',
  depositAddress: 'd'.repeat(64),
  deadline: '2026-11-14T12:00:00Z',
  originAsset: 'nep141:bnb-usdt.omdep.near',
  destinationAsset: 'nep141:sol-usdc.omft.near',
  amountIn: '5100000000000000000',
  amountOut: '5000000',
  minAmountOut: '5000000',
  sendSymbol: 'USDT',
  getSymbol: 'USDC',
  getDecimals: '6',
  getChain: 'intents',
  recipient: NEAR_ID,
  refundTo: NEAR_ID,
  feeBps: '1',
  seconds: '20',
  payFrom: 'intents',
  sendDecimals: '18',
  ...extra,
})
const PAYMENT: PlanCore = {
  hashVersion: 1,
  id: 'p1',
  createdBy: 'agent',
  createdAt: '2026-11-14T10:00:00Z',
  expiresAt: '2026-11-14T10:30:00Z',
  intent: { outcome: 'pay', asset: 'USDC', amount: '15', chain: null, to: SOL, toAsset: null, toChain: 'solana' },
  recipient: { address: SOL, why: 'typed' },
  summary: 'Pay 15 USDC on solana',
  steps: [
    near('nep141:bnb-usdt.omdep.near', 5_100_000_000_000_000_000n),
    evmTransferStep({ chainId: 8453, from: EVM, to: '0x8f436D184823B77188DE973322278686c3780C2c', token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', amount: 10_200_000n, gas: 60_000n, symbol: 'USDC', decimals: 6 }),
    near('nep141:sol-usdc.omft.near', 15_300_000n),
  ],
  swaps: [
    swap({}),
    swap({ originAsset: 'nep141:base-usdc.omft.near', amountIn: '10200000', amountOut: '10300000', minAmountOut: '10300000', sendSymbol: 'USDC', sendDecimals: '6', refundTo: EVM, payFrom: 'evm', sendChainId: '8453', sendToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }),
    swap({ originAsset: 'nep141:sol-usdc.omft.near', amountIn: '15300000', amountOut: '15000000', minAmountOut: '15000000', sendSymbol: 'USDC', sendDecimals: '6', getChain: 'sol', recipient: SOL, role: 'payout', fromBalance: '0' }),
  ],
}

const progress = (stage: ChatSwap['stage'], link: string | null = null): ChatSwap => ({ stage, got: stage === 'done' ? '15 USDC' : null, refunded: null, link })
const at = (status: PlanStatus, txs: [number, StepTx][] = [], swaps: (ChatSwap | null)[] = [], held = false) => journeyOf({ core: PAYMENT, status, txs: new Map(txs), swaps, held })
const states = (journey: ReturnType<typeof journeyOf>) => journey.steps.map((step) => `${step.id}:${step.state}`)

describe('a payment’s journey', () => {
  it('lays out every step from review to the money landing, before anything happens', () => {
    const journey = at('awaiting_review')
    expect(journey.steps.map((step) => step.label)).toEqual(['Review', 'Sign', '5.1 USDT on NEAR', '10.2 USDC on Base', 'In your Intents balance', 'Payout on NEAR', 'Paid on Solana'])
    expect(states(journey)).toEqual(['review:active', 'sign:pending', 'tx:0:pending', 'tx:1:pending', 'legs:pending', 'tx:2:pending', 'payout:pending'])
    expect(journey).toMatchObject({ done: false, failed: false })
  })

  it('follows each transaction on its own chain, then the legs landing, then the held payout going out', () => {
    const sent = at('submitted', [[0, { state: 'confirmed', id: 'NearTx1' }], [1, { state: 'sent', id: '0xabc12345' }]], [], true)
    expect(states(sent)).toEqual(['review:done', 'sign:done', 'tx:0:done', 'tx:1:active', 'legs:active', 'tx:2:pending', 'payout:pending'])
    expect(sent.steps[3]).toMatchObject({ detail: 'Waiting for Base', link: { url: 'https://basescan.org/tx/0xabc12345' } })
    expect(sent.steps[5]?.detail).toBe('Signed; sent once the parts land')
    const landing = at('submitted', [[0, { state: 'confirmed', id: 'NearTx1' }], [1, { state: 'confirmed', id: '0xabc12345' }]], [progress('done'), progress('swapping')], true)
    expect(landing.steps.find((step) => step.id === 'legs')).toMatchObject({ state: 'active', detail: '1 of 2 parts landed' })
    const paying = at('confirmed', [[0, { state: 'confirmed', id: 'NearTx1' }], [1, { state: 'confirmed', id: '0xabc12345' }], [2, { state: 'confirmed', id: 'NearTx3' }]], [progress('done'), progress('done'), null])
    expect(states(paying).slice(-3)).toEqual(['legs:done', 'tx:2:done', 'payout:active'])
    expect(paying.done).toBe(false)
    const paid = at('confirmed', [[0, { state: 'confirmed', id: 'NearTx1' }], [1, { state: 'confirmed', id: '0xabc12345' }], [2, { state: 'confirmed', id: 'NearTx3' }]], [progress('done'), progress('done'), progress('done', 'https://solscan.io/tx/x')])
    expect(paid.steps.at(-1)).toMatchObject({ state: 'done', detail: '15 USDC', link: { url: 'https://solscan.io/tx/x' } })
    expect(paid).toMatchObject({ done: true, failed: false })
  })

  it('fails where it failed: a leg not swapped, a transaction the chain didn’t run, a plan cancelled', () => {
    const refunded = at('submitted', [[0, { state: 'confirmed', id: 'NearTx1' }], [1, { state: 'confirmed', id: '0xabc12345' }]], [progress('done'), progress('refunded')], true)
    expect(refunded.steps.find((step) => step.id === 'legs')?.state).toBe('failed')
    expect(refunded.failed).toBe(true)
    expect(at('failed', [[0, { state: 'failed', id: 'NearTx1' }]]).steps[2]).toMatchObject({ state: 'failed', detail: 'NEAR didn’t run it' })
    expect(at('failed').steps[1]).toMatchObject({ state: 'failed', detail: 'Not sent' })
    expect(at('cancelled')).toMatchObject({ failed: true, done: false })
  })
})

describe('a send’s journey', () => {
  it('is review, sign and its one transaction', () => {
    const send: PlanCore = { ...PAYMENT, intent: { ...PAYMENT.intent, outcome: 'send' }, steps: [PAYMENT.steps[1]!], swaps: undefined }
    const journey = journeyOf({ core: send, status: 'confirmed', txs: new Map([[0, { state: 'confirmed', id: '0xabc12345' }]]), swaps: [], held: false })
    expect(states(journey)).toEqual(['review:done', 'sign:done', 'tx:0:done'])
    expect(journey.steps[2]?.label).toBe('On Base')
    expect(journey.done).toBe(true)
  })
})
