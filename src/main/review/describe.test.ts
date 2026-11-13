import { hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import { nearCallStep, type NearCall } from '../../shared/near/calls'
import { nearPublicKey, nearTransferStep } from '../../shared/near/transaction'
import type { PlanIntent, PlanStep, PlanSwap } from '../../shared/plan'
import { createPlanStore, PLAN_TTL_MS, type PlanView } from '../plans/store'
import { describeForReview } from './describe'

const FROM = 'a'.repeat(64)
const KEY = nearPublicKey(hexToBytes(FROM))
const OWN: Account[] = [{ chain: 'near', path: "m/44'/397'/0'", address: FROM }]
const INTENT: PlanIntent = { outcome: 'send', asset: 'NEAR', amount: '1.5', chain: 'near', to: 'alice.near', toAsset: null, toChain: null }
const STEP = nearTransferStep({ signerId: FROM, publicKey: KEY, receiverId: 'alice.near', deposit: '1500000000000000000000000' })
const FEE = 267_819_075_000_000_000_000n

async function planWith(steps: PlanStep[], intent: PlanIntent = INTENT): Promise<PlanView> {
  const store = createPlanStore({ buildSteps: async () => ({ ok: true, steps }) })
  const made = await store.create({ intent, createdBy: 'agent', owner: 'chat', own: OWN, typed: [`send to ${intent.to}`] })
  if (!made.ok) throw new Error(made.reason)
  return made.plan
}

describe('what the review window shows', () => {
  it('reads every value from the step the signer signs', async () => {
    const plan = await planWith([STEP])
    expect(describeForReview(plan, 'NEAR mainnet', FEE)).toEqual({
      id: plan.id,
      kind: 'send',
      swap: null,
      hash: plan.hash,
      network: 'NEAR mainnet',
      chain: 'NEAR',
      feeAsset: 'NEAR',
      from: FROM,
      publicKey: KEY,
      to: 'alice.near',
      toKind: 'named',
      toWhy: 'typed',
      amount: '1.5',
      amountYocto: '1500000000000000000000000',
      asset: 'NEAR',
      maxFee: '0.000267819075',
      maxFeeYocto: '267819075000000000000',
      maxTotal: '1.500267819075',
      actions: [{ kind: 'Transfer', amount: '1.5', method: null, summary: 'Send 1.5 NEAR to alice.near' }],
      expiresAt: plan.core.expiresAt,
    })
  })

  it('shows the deposit the step holds, not the amount the agent asked for', async () => {
    const plan = await planWith([{ ...STEP, fields: { ...STEP.fields, deposit: '2000000000000000000000000' } }])
    expect(describeForReview(plan, 'NEAR mainnet', FEE)).toMatchObject({ amount: '2', actions: [{ amount: '2' }] })
  })

  it('leaves out the fee and the total when the chain couldn’t be asked', async () => {
    expect(describeForReview(await planWith([STEP]), 'NEAR mainnet', null)).toMatchObject({ maxFee: null, maxFeeYocto: null, maxTotal: null })
  })

  it('says what kind of account the transfer pays', async () => {
    const implicit = 'b'.repeat(64)
    const plan = await planWith([{ ...STEP, fields: { ...STEP.fields, receiverId: implicit } }], { ...INTENT, to: implicit })
    expect(describeForReview(plan, 'NEAR mainnet', FEE)).toMatchObject({ to: implicit, toKind: 'implicit' })
  })

  it('shows nothing for a plan Ink can’t send', async () => {
    expect(describeForReview(await planWith([]), 'NEAR mainnet', FEE)).toBeNull()
    expect(describeForReview(await planWith([STEP, STEP]), 'NEAR mainnet', FEE)).toBeNull()
    expect(describeForReview(await planWith([{ ...STEP, action: 'stake' }]), 'NEAR mainnet', FEE)).toBeNull()
  })

  it('shows nothing when the step pays someone other than the plan’s checked recipient', async () => {
    const plan = await planWith([{ ...STEP, fields: { ...STEP.fields, receiverId: 'mallory.near' } }])
    expect(describeForReview(plan, 'NEAR mainnet', FEE)).toBeNull()
  })
})

describe('what the review window shows for a swap', () => {
  const DEPOSIT = 'd'.repeat(64)
  const EVM = '0x1111111111111111111111111111111111111111'
  const FIVE = 5n * 10n ** 24n
  const calls = (amount = FIVE, to = DEPOSIT): NearCall[] => [
    { method: 'storage_deposit', accountId: FROM },
    { method: 'storage_deposit', accountId: DEPOSIT },
    { method: 'near_deposit', amount },
    { method: 'ft_transfer', receiverId: to, amount },
  ]
  const TERMS: PlanSwap = {
    via: '1click',
    depositAddress: DEPOSIT,
    deadline: new Date(Date.now() + PLAN_TTL_MS + 30 * 60_000).toISOString(),
    originAsset: 'nep141:wrap.near',
    destinationAsset: 'nep141:base-usdc.omft.near',
    amountIn: FIVE.toString(),
    amountOut: '17400531',
    minAmountOut: '17226525',
    sendSymbol: 'NEAR',
    getSymbol: 'USDC',
    getDecimals: '6',
    getChain: 'base',
    recipient: EVM,
    refundTo: FROM,
    feeBps: '20',
    seconds: '22',
  }
  async function swapPlan(step = nearCallStep({ signerId: FROM, publicKey: KEY, receiverId: 'wrap.near', calls: calls() }), terms: Partial<PlanSwap> = {}) {
    const swap = { ...TERMS, ...terms }
    const store = createPlanStore({ buildSteps: async () => ({ ok: true, steps: [step], swap, payout: { address: swap.recipient, chain: swap.getChain === 'intents' ? 'near' : 'evm' } }) })
    const own: Account[] = [{ chain: 'near', path: "m/44'/397'/0'", address: FROM }, { chain: 'evm', path: "m/44'/60'/0'/0/0", address: EVM }]
    const made = await store.create({ intent: { outcome: 'swap', asset: 'NEAR', amount: '5', chain: 'near', to: null, toAsset: 'USDC', toChain: 'base' }, createdBy: 'agent', owner: 'chat', own, typed: [] })
    if (!made.ok) throw new Error(made.reason)
    return made.plan
  }

  it('shows what goes in and comes out, where it’s paid and refunded, and each call in plain words', async () => {
    const plan = await swapPlan()
    expect(describeForReview(plan, 'NEAR mainnet', FEE)).toMatchObject({
      kind: 'swap',
      swap: { send: '5 NEAR', from: 'wallet', get: '17.400531 USDC', least: '17.226525 USDC', getChain: 'Base', refundTo: FROM, depositAddress: DEPOSIT, deadline: TERMS.deadline, fee: '0.2%', seconds: 22 },
      from: FROM,
      to: EVM,
      toKind: 'other-chain',
      toWhy: 'own',
      amount: '5',
      maxTotal: '5.002767819075000000000001',
      actions: [
        { kind: 'FunctionCall', method: 'storage_deposit', amount: '0.00125', summary: `Register ${FROM} with wNEAR, paying 0.00125 NEAR for its storage` },
        { kind: 'FunctionCall', method: 'storage_deposit', amount: '0.00125', summary: `Register ${DEPOSIT} with wNEAR, paying 0.00125 NEAR for its storage` },
        { kind: 'FunctionCall', method: 'near_deposit', amount: '5', summary: 'Wrap 5 NEAR into wNEAR' },
        { kind: 'FunctionCall', method: 'ft_transfer', amount: '0.000000000000000000000001', summary: `Send 5 wNEAR to ${DEPOSIT}` },
      ],
    })
  })

  it('shows a payout to an address the person typed as theirs to check', async () => {
    const friend = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    const store = createPlanStore({ buildSteps: async () => ({ ok: true, steps: [nearCallStep({ signerId: FROM, publicKey: KEY, receiverId: 'wrap.near', calls: calls() })], swap: { ...TERMS, recipient: friend }, payout: { address: friend, chain: 'evm' } }) })
    const made = await store.create({ intent: { outcome: 'swap', asset: 'NEAR', amount: '5', chain: 'near', to: friend, toAsset: 'USDC', toChain: 'base' }, createdBy: 'agent', owner: 'chat', own: [{ chain: 'near', path: '', address: FROM }], typed: [`send it to ${friend}`] })
    if (!made.ok) throw new Error(made.reason)
    expect(describeForReview(made.plan, 'NEAR mainnet', FEE)).toMatchObject({ kind: 'swap', to: friend, toKind: 'other-chain', toWhy: 'typed', swap: { refundTo: FROM } })
  })

  it('shows a swap into the Intents balance as such', async () => {
    const plan = await swapPlan(undefined, { getChain: 'intents', recipient: FROM })
    expect(describeForReview(plan, 'NEAR mainnet', FEE)).toMatchObject({ swap: { getChain: 'your NEAR Intents balance' }, to: FROM, toKind: 'implicit' })
  })

  it('shows nothing when the step and the terms disagree', async () => {
    const step = (amount: bigint, to = DEPOSIT) => nearCallStep({ signerId: FROM, publicKey: KEY, receiverId: 'wrap.near', calls: calls(amount, to) })
    expect(describeForReview(await swapPlan(step(FIVE, 'e'.repeat(64))), 'NEAR mainnet', FEE)).toBeNull()
    expect(describeForReview(await swapPlan(step(FIVE - 1n)), 'NEAR mainnet', FEE)).toBeNull()
    expect(describeForReview(await swapPlan(undefined, { refundTo: 'c'.repeat(64) }), 'NEAR mainnet', FEE)).toBeNull()
    expect(describeForReview(await swapPlan(STEP), 'NEAR mainnet', FEE)).toBeNull()
  })

  describe('paid from the Intents balance', () => {
    const USDC = 'nep141:base-usdc.omft.near'
    const INTENTS_TERMS: Partial<PlanSwap> = { originAsset: USDC, destinationAsset: 'nep141:wrap.near', amountIn: '25000000', sendSymbol: 'USDC', sendDecimals: '6', getSymbol: 'NEAR', getDecimals: '24', amountOut: '7000000000000000000000000', minAmountOut: '6930000000000000000000000', getChain: 'intents', recipient: FROM, payFrom: 'intents' }
    const move = (amount = 25_000_000n, tokenId = USDC, to = DEPOSIT) => nearCallStep({ signerId: FROM, publicKey: KEY, receiverId: 'intents.near', calls: [{ method: 'mt_transfer', receiverId: to, tokenId, amount }] })

    it('shows the token leaving the Intents balance, the refund going back there, and the move in plain words', async () => {
      const plan = await swapPlan(move(), INTENTS_TERMS)
      expect(describeForReview(plan, 'NEAR mainnet', FEE)).toMatchObject({
        kind: 'swap',
        swap: { send: '25 USDC', from: 'intents', get: '7 NEAR', least: '6.93 NEAR', refundTo: FROM },
        amount: '25',
        amountYocto: '25000000',
        asset: 'USDC',
        // Only the yoctoNEAR the move attaches, and the fee, leave the NEAR account.
        maxTotal: '0.000267819075000000000001',
        actions: [{ kind: 'FunctionCall', method: 'mt_transfer', amount: '0.000000000000000000000001', summary: `Move 25 USDC from your NEAR Intents balance to NEAR Intents’ deposit address ${DEPOSIT}` }],
      })
    })

    it('shows nothing when the move isn’t exactly the swap’s token, amount and deposit address', async () => {
      expect(describeForReview(await swapPlan(move(24_000_000n), INTENTS_TERMS), 'NEAR mainnet', FEE)).toBeNull()
      expect(describeForReview(await swapPlan(move(undefined, 'nep141:usdt.tether-token.near'), INTENTS_TERMS), 'NEAR mainnet', FEE)).toBeNull()
      expect(describeForReview(await swapPlan(move(undefined, undefined, 'e'.repeat(64)), INTENTS_TERMS), 'NEAR mainnet', FEE)).toBeNull()
      // A wallet swap's calls under terms that say the Intents balance pays, and the other way round.
      expect(describeForReview(await swapPlan(undefined, INTENTS_TERMS), 'NEAR mainnet', FEE)).toBeNull()
      expect(describeForReview(await swapPlan(move(), { ...INTENTS_TERMS, payFrom: undefined }), 'NEAR mainnet', FEE)).toBeNull()
    })
  })
})
