import { hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import { nearPublicKey, nearTransferStep } from '../../shared/near/transaction'
import type { PlanIntent, PlanStep } from '../../shared/plan'
import { createPlanStore, type PlanView } from '../plans/store'
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
      hash: plan.hash,
      network: 'NEAR mainnet',
      from: FROM,
      publicKey: KEY,
      to: 'alice.near',
      toKind: 'named',
      toWhy: 'typed',
      amount: '1.5',
      amountYocto: '1500000000000000000000000',
      asset: 'NEAR',
      maxFee: '0.000267819075',
      maxTotal: '1.500267819075',
      actions: [{ kind: 'Transfer', amount: '1.5', method: null }],
      expiresAt: plan.core.expiresAt,
    })
  })

  it('shows the deposit the step holds, not the amount the agent asked for', async () => {
    const plan = await planWith([{ ...STEP, fields: { ...STEP.fields, deposit: '2000000000000000000000000' } }])
    expect(describeForReview(plan, 'NEAR mainnet', FEE)).toMatchObject({ amount: '2', actions: [{ amount: '2' }] })
  })

  it('leaves out the fee and the total when the chain couldn’t be asked', async () => {
    expect(describeForReview(await planWith([STEP]), 'NEAR mainnet', null)).toMatchObject({ maxFee: null, maxTotal: null })
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
