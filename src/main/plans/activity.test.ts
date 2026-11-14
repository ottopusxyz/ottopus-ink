import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import type { PlanJourney, RecentSwap } from '../../shared/ipc'
import type { PlanIntent } from '../../shared/plan'
import { activityOf } from './activity'
import { createPlanStore } from './store'

const OWN: Account[] = [{ chain: 'near', path: "m/44'/397'/0'", address: 'a'.repeat(64) }]
const SEND: PlanIntent = { outcome: 'send', asset: 'NEAR', amount: '1.5', chain: 'near', to: 'alice.near', toAsset: null, toChain: null }
const JOURNEY: PlanJourney = { steps: [], done: false, failed: false }
const recent = (planId: string): RecentSwap => ({ planId, send: '2 NEAR', get: 'USDC', where: 'on Base', progress: null, startedAt: 1 })

async function store() {
  let ids = 0
  const plans = createPlanStore({ newId: () => `plan-${++ids}` })
  const made = async (owner: string) => {
    const result = await plans.create({ intent: SEND, createdBy: 'agent', owner, own: OWN, typed: ['send 1.5 NEAR to alice.near'] })
    if (!result.ok) throw new Error(result.reason)
    return result.plan.id
  }
  return { plans, made }
}

describe('what Activity shows', () => {
  it('lists every chat’s plans that reached review, newest first, and no drafts', async () => {
    const { plans, made } = await store()
    const first = await made('chat-1')
    const draft = await made('chat-2')
    const second = await made('chat-2')
    plans.move(first, 'chat-1', 'awaiting_review')
    plans.move(second, 'chat-2', 'awaiting_review')
    plans.move(second, 'chat-2', 'cancelled')
    const activity = activityOf({ plans: plans.list(), journey: () => JOURNEY, swap: () => null, transactionId: () => null, recent: [] })
    expect(activity.plans.map(({ plan }) => [plan.id, plan.status])).toEqual([
      [second, 'cancelled'],
      [first, 'awaiting_review'],
    ])
    expect(activity.plans.some(({ plan }) => plan.id === draft)).toBe(false)
  })

  it('carries each plan’s journey, swap and last transaction, in the chat’s own shape', async () => {
    const { plans, made } = await store()
    const id = await made('chat-1')
    plans.move(id, 'chat-1', 'awaiting_review')
    const swap = { stage: 'swapping' as const, got: null, refunded: null, link: null }
    const [entry] = activityOf({ plans: plans.list(), journey: () => JOURNEY, swap: () => swap, transactionId: () => 'Tx1', recent: [] }).plans
    expect(entry?.plan).toEqual({ id, status: 'awaiting_review', journey: JOURNEY, swap, transactionId: 'Tx1', outcome: 'send', asset: 'NEAR', amount: '1.5', chain: 'near', to: 'alice.near', toAsset: null, toChain: null })
    expect(entry?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('keeps the swaps Ink follows from before it last started, and leaves out this run’s, legs included', async () => {
    const { plans, made } = await store()
    const id = await made('chat-1')
    plans.move(id, 'chat-1', 'awaiting_review')
    const activity = activityOf({ plans: plans.list(), journey: () => JOURNEY, swap: () => null, transactionId: () => null, recent: [recent(id), recent(`${id}#0`), recent('gone'), recent('gone-pay#1')] })
    expect(activity.earlier.map((each) => each.planId)).toEqual(['gone', 'gone-pay#1'])
  })
})
