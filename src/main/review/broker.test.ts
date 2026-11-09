import { hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it, vi } from 'vitest'
import type { Account } from '../../shared/accounts'
import { nearPublicKey, nearTransferStep } from '../../shared/near/transaction'
import type { PlanIntent, PlanStatus } from '../../shared/plan'
import type { ReviewState } from '../../shared/review'
import { createPlanStore, PLAN_TTL_MS, type PlanStore, type PlanView } from '../plans/store'
import type { SendResult } from '../vault/send-plan'
import { ARM_DELAY_MS, createReviewBroker, GESTURE_WINDOW_MS } from './broker'
import { describeForReview } from './describe'
import { isApprovalKey, type KeyInput } from './input'

const FROM = 'a'.repeat(64)
const OWN: Account[] = [{ chain: 'near', path: "m/44'/397'/0'", address: FROM }]
const OWNER = 'chat-1'
const INTENT: PlanIntent = { outcome: 'send', asset: 'NEAR', amount: '1', chain: 'near', to: 'alice.near', toAsset: null, toChain: null }
const STEP = nearTransferStep({ signerId: FROM, publicKey: nearPublicKey(hexToBytes(FROM)), receiverId: 'alice.near', deposit: '1000000000000000000000000' })
const TX = 'tx-id'

/** A broker over a real store, with a clock the test moves and a sender that confirms unless told otherwise. */
function setup({ send, unlocked = true }: { send?: (id: string, owner: string) => Promise<SendResult>; unlocked?: boolean } = {}) {
  let clock = 10_000
  let open = unlocked
  const store = createPlanStore({ buildSteps: async () => ({ ok: true, steps: [STEP] }), monotonic: () => clock })
  const sender = {
    send: vi.fn(
      send ??
        (async (id: string, owner: string): Promise<SendResult> => {
          store.move(id, owner, 'signing')
          store.move(id, owner, 'submitted')
          const done = store.move(id, owner, 'confirmed')
          if (!done.ok) throw new Error(done.reason)
          return { ok: true, plan: done.plan, transactionId: TX }
        }),
    ),
  }
  const states: (ReviewState | null)[] = []
  const broker = createReviewBroker({
    store,
    sender,
    describe: async (plan) => describeForReview(plan, 'NEAR mainnet', 1n),
    unlocked: () => open,
    onState: (state) => states.push(state),
    monotonic: () => clock,
  })
  return {
    store,
    sender,
    broker,
    states,
    tick: (ms: number) => {
      clock += ms
    },
    lock: () => {
      open = false
    },
    unlock: () => {
      open = true
    },
  }
}

async function draft(store: PlanStore, owner = OWNER): Promise<{ id: string; hash: string }> {
  const made = await store.create({ intent: INTENT, createdBy: 'agent', owner, own: OWN, typed: ['send 1 NEAR to alice.near'] })
  if (!made.ok) throw new Error(made.reason)
  return { id: made.plan.id, hash: made.plan.hash }
}

/** Offers a plan and waits out the arm delay, so the next click can approve it. */
async function shownAndArmed(env: ReturnType<typeof setup>) {
  const plan = await draft(env.store)
  const notify = vi.fn<(status: PlanStatus) => void>()
  await env.broker.offer(plan.id, OWNER, notify)
  env.tick(ARM_DELAY_MS)
  return { ...plan, notify }
}

/** A click that Electron saw, then the approve it led to. */
async function click(env: ReturnType<typeof setup>, id: string, hash: string) {
  env.broker.input()
  return env.broker.approve(id, hash)
}

describe('putting a plan up for review', () => {
  it('moves a draft Ink can send to awaiting review, describes it from its step, and tells its chat', async () => {
    const env = setup()
    const { id, hash } = await draft(env.store)
    const notify = vi.fn()
    await env.broker.offer(id, OWNER, notify)
    expect(env.store.get(id, OWNER)?.status).toBe('awaiting_review')
    expect(notify).toHaveBeenCalledWith('awaiting_review')
    expect(env.broker.state()).toMatchObject({ plan: { id, hash, to: 'alice.near', amount: '1' }, status: 'awaiting_review', armed: false, sending: false, waiting: 0 })
  })

  it('leaves a plan it can’t describe as a draft, and shows nothing', async () => {
    const env = setup()
    const store = createPlanStore({ buildSteps: async () => ({ ok: true, steps: [] }) })
    const broker = createReviewBroker({ store, sender: env.sender, describe: async (plan) => describeForReview(plan, 'NEAR mainnet', 1n), unlocked: () => true, onState: () => {} })
    const { id } = await draft(store)
    await broker.offer(id, OWNER)
    expect(store.get(id, OWNER)?.status).toBe('draft')
    expect(broker.state()).toBeNull()
  })

  it('ignores a plan that isn’t a draft, isn’t the owner’s, or is already up, without asking the chain about it', async () => {
    const env = setup()
    const describe = vi.fn(async (plan: PlanView) => describeForReview(plan, 'NEAR mainnet', 1n))
    env.broker = createReviewBroker({ store: env.store, sender: env.sender, describe, unlocked: () => true, onState: () => {} })
    const { id } = await draft(env.store)
    await env.broker.offer(id, 'another-chat')
    expect(env.broker.state()).toBeNull()
    await env.broker.offer(id, OWNER)
    await env.broker.offer(id, OWNER)
    expect(env.broker.state()?.waiting).toBe(0)
    const cancelled = await draft(env.store)
    env.store.move(cancelled.id, OWNER, 'cancelled')
    await env.broker.offer(cancelled.id, OWNER)
    expect(env.broker.state()?.waiting).toBe(0)
    expect(describe).toHaveBeenCalledTimes(1)
  })

  it('doesn’t put up a plan that was cancelled while it was being described', async () => {
    const env = setup()
    const { id } = await draft(env.store)
    const offered = env.broker.offer(id, OWNER)
    env.store.move(id, OWNER, 'cancelled')
    await offered
    expect(env.broker.state()).toBeNull()
  })

  it('shows one plan at a time and says how many wait behind it', async () => {
    const env = setup()
    const first = await draft(env.store)
    const second = await draft(env.store)
    await env.broker.offer(first.id, OWNER)
    await env.broker.offer(second.id, OWNER)
    expect(env.broker.state()).toMatchObject({ plan: { id: first.id }, waiting: 1 })
  })
})

describe('approving', () => {
  it('approves and sends the plan shown after a real click once armed, and tells its chat each status', async () => {
    const env = setup()
    const { id, hash, notify } = await shownAndArmed(env)
    expect(await click(env, id, hash)).toEqual({ ok: true })
    expect(env.sender.send).toHaveBeenCalledWith(id, OWNER)
    expect(env.broker.state()).toMatchObject({ status: 'confirmed', transactionId: TX, sending: false, failure: null })
    expect(notify.mock.calls.map(([status]) => status)).toEqual(['awaiting_review', 'approved', 'confirmed'])
  })

  it('refuses before the window has been up for the arm delay, even with a real click', async () => {
    const env = setup()
    const { id, hash } = await draft(env.store)
    await env.broker.offer(id, OWNER)
    env.tick(ARM_DELAY_MS - 1)
    expect(await click(env, id, hash)).toEqual({ ok: false, reason: 'not-armed' })
    expect(env.store.get(id, OWNER)?.status).toBe('awaiting_review')
    env.tick(1)
    expect(await click(env, id, hash)).toEqual({ ok: true })
  })

  it('starts the arm delay again when the window takes focus, so the click that brought it forward can’t approve', async () => {
    const env = setup()
    const { id, hash } = await shownAndArmed(env)
    env.broker.shown()
    expect(await click(env, id, hash)).toEqual({ ok: false, reason: 'not-armed' })
    env.tick(ARM_DELAY_MS)
    expect(await click(env, id, hash)).toEqual({ ok: true })
  })

  it('refuses with no real click or key press, which a script in the page can’t make', async () => {
    const env = setup()
    const { id, hash } = await shownAndArmed(env)
    expect(await env.broker.approve(id, hash)).toEqual({ ok: false, reason: 'no-gesture' })
    expect(env.sender.send).not.toHaveBeenCalled()
    expect(env.store.get(id, OWNER)?.status).toBe('awaiting_review')
  })

  it('doesn’t count a click from before the window armed', async () => {
    const env = setup()
    const { id, hash } = await draft(env.store)
    await env.broker.offer(id, OWNER)
    env.tick(ARM_DELAY_MS - 1)
    env.broker.input()
    env.tick(1)
    expect(await env.broker.approve(id, hash)).toEqual({ ok: false, reason: 'no-gesture' })
  })

  it('doesn’t count a click older than the gesture window', async () => {
    const env = setup()
    const { id, hash } = await shownAndArmed(env)
    env.broker.input()
    env.tick(GESTURE_WINDOW_MS + 1)
    expect(await env.broker.approve(id, hash)).toEqual({ ok: false, reason: 'no-gesture' })
    env.broker.input()
    env.tick(GESTURE_WINDOW_MS)
    expect(await env.broker.approve(id, hash)).toEqual({ ok: true })
  })

  it('counts a key press only from after the window armed, and never its release, as the window passes them on', async () => {
    const env = setup({ send: async () => ({ ok: false, reason: 'chain-unavailable', status: 'approved' }) })
    const key = (type: string, key: string) => {
      const input: KeyInput = { type, key, isAutoRepeat: false }
      if (isApprovalKey(input)) env.broker.input()
    }
    const { id, hash } = await draft(env.store)
    await env.broker.offer(id, OWNER)
    // Space pressed before the window armed, let go after.
    env.tick(ARM_DELAY_MS - 100)
    key('keyDown', ' ')
    env.tick(200)
    key('keyUp', ' ')
    expect(await env.broker.approve(id, hash)).toEqual({ ok: false, reason: 'no-gesture' })
    // One press of Enter, approved, then let go: the release can't approve again.
    key('keyDown', 'Enter')
    expect(await env.broker.approve(id, hash)).toEqual({ ok: false, reason: 'chain-unavailable' })
    key('keyUp', 'Enter')
    expect(await env.broker.approve(id, hash)).toEqual({ ok: false, reason: 'no-gesture' })
    expect(env.sender.send).toHaveBeenCalledTimes(1)
  })

  it('lets one click approve once', async () => {
    const env = setup({ send: async () => ({ ok: false, reason: 'chain-unavailable', status: 'approved' }) })
    const { id, hash } = await shownAndArmed(env)
    expect(await click(env, id, hash)).toEqual({ ok: false, reason: 'chain-unavailable' })
    expect(await env.broker.approve(id, hash)).toEqual({ ok: false, reason: 'no-gesture' })
    expect(env.sender.send).toHaveBeenCalledTimes(1)
  })

  it('refuses a plan or hash other than the one on show', async () => {
    const env = setup()
    const { id, hash } = await shownAndArmed(env)
    const other = await draft(env.store)
    await env.broker.offer(other.id, OWNER)
    expect(await click(env, other.id, other.hash)).toEqual({ ok: false, reason: 'stale' })
    expect(await click(env, id, other.hash)).toEqual({ ok: false, reason: 'stale' })
    expect(await click(env, other.id, hash)).toEqual({ ok: false, reason: 'stale' })
    expect(await click(env, id, hash)).toEqual({ ok: true })
  })

  it('refuses while locked and keeps the plan waiting, then goes ahead once unlocked', async () => {
    const env = setup({ unlocked: false })
    const { id, hash } = await shownAndArmed(env)
    expect(await click(env, id, hash)).toEqual({ ok: false, reason: 'locked' })
    expect(env.store.get(id, OWNER)?.status).toBe('awaiting_review')
    expect(env.broker.state()).toMatchObject({ unlocked: false, failure: 'locked' })
    env.unlock()
    expect(await click(env, id, hash)).toEqual({ ok: true })
  })

  it('refuses a plan that expired while on show', async () => {
    const env = setup()
    const { id, hash } = await shownAndArmed(env)
    env.tick(PLAN_TTL_MS)
    expect(await click(env, id, hash)).toEqual({ ok: false, reason: 'cannot-move' })
    expect(env.sender.send).not.toHaveBeenCalled()
    expect(env.broker.state()?.status).toBe('expired')
  })

  it('keeps the plan approved when the send stops short of signing, and sends it again on the next click', async () => {
    const send = vi.fn<(id: string, owner: string) => Promise<SendResult>>(async () => ({ ok: false, reason: 'chain-unavailable', status: 'approved' }))
    const env = setup({ send })
    const { id, hash } = await shownAndArmed(env)
    await click(env, id, hash)
    expect(env.broker.state()).toMatchObject({ status: 'approved', failure: 'chain-unavailable' })
    send.mockResolvedValueOnce({ ok: false, reason: 'earlier-pending', status: 'approved' })
    expect(await click(env, id, hash)).toEqual({ ok: false, reason: 'earlier-pending' })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('shows any reason it doesn’t explain as a refusal', async () => {
    const env = setup({ send: async () => ({ ok: false, reason: 'too-many' }) })
    const { id, hash } = await shownAndArmed(env)
    expect(await click(env, id, hash)).toEqual({ ok: false, reason: 'refused' })
  })

  it('shows it as sending until the send answers, and takes no second approval meanwhile', async () => {
    let finish: (result: SendResult) => void = () => {}
    const env = setup({ send: () => new Promise((resolve) => (finish = resolve)) })
    const { id, hash } = await shownAndArmed(env)
    const approving = click(env, id, hash)
    expect(env.broker.state()).toMatchObject({ sending: true, status: 'approved' })
    expect(await click(env, id, hash)).toEqual({ ok: false, reason: 'busy' })
    env.broker.reject(id)
    env.broker.closed()
    expect(env.store.get(id, OWNER)?.status).toBe('approved')
    finish({ ok: false, reason: 'refused', status: 'failed' })
    await approving
    expect(env.broker.state()).toMatchObject({ sending: false, failure: 'refused' })
  })
})

describe('rejecting, expiry and moving on', () => {
  it('cancels the plan on reject, signs nothing, tells its chat, and shows the next', async () => {
    const env = setup()
    const first = await draft(env.store)
    const second = await draft(env.store)
    const notify = vi.fn()
    await env.broker.offer(first.id, OWNER, notify)
    await env.broker.offer(second.id, OWNER)
    env.broker.reject(first.id)
    expect(env.store.get(first.id, OWNER)?.status).toBe('cancelled')
    expect(notify).toHaveBeenLastCalledWith('cancelled')
    expect(env.sender.send).not.toHaveBeenCalled()
    expect(env.broker.state()).toMatchObject({ plan: { id: second.id }, armed: false, waiting: 0 })
  })

  it('rejects only the plan on show', async () => {
    const env = setup()
    const { id } = await shownAndArmed(env)
    env.broker.reject('another-plan')
    expect(env.store.get(id, OWNER)?.status).toBe('awaiting_review')
    expect(env.broker.state()?.plan.id).toBe(id)
  })

  it('counts closing the window as a reject while the plan waits on the person', async () => {
    const env = setup()
    const { id } = await shownAndArmed(env)
    env.broker.closed()
    expect(env.store.get(id, OWNER)?.status).toBe('cancelled')
    expect(env.broker.state()).toBeNull()
  })

  it('cancels an approved plan whose send stopped short, when rejected', async () => {
    const env = setup({ send: async () => ({ ok: false, reason: 'chain-unavailable', status: 'approved' }) })
    const { id, hash } = await shownAndArmed(env)
    await click(env, id, hash)
    env.broker.reject(id)
    expect(env.store.get(id, OWNER)?.status).toBe('cancelled')
  })

  it('shows a plan as expired once its time is up, and tells its chat', async () => {
    const env = setup()
    const { id, notify } = await shownAndArmed(env)
    env.tick(PLAN_TTL_MS)
    env.broker.refresh()
    expect(env.states.at(-1)).toMatchObject({ plan: { id }, status: 'expired' })
    expect(notify).toHaveBeenLastCalledWith('expired')
  })

  it('keeps a finished plan on show until dismissed, then shows the next or nothing', async () => {
    const env = setup()
    const { id, hash } = await shownAndArmed(env)
    const second = await draft(env.store)
    await env.broker.offer(second.id, OWNER)
    await click(env, id, hash)
    expect(env.broker.state()).toMatchObject({ plan: { id }, status: 'confirmed' })
    env.broker.dismiss(id)
    expect(env.broker.state()).toMatchObject({ plan: { id: second.id }, armed: false })
    env.broker.closed()
    expect(env.broker.state()).toBeNull()
    expect(env.states.at(-1)).toBeNull()
  })

  it('won’t dismiss a plan that still waits on the person', async () => {
    const env = setup()
    const { id } = await shownAndArmed(env)
    env.broker.dismiss(id)
    expect(env.broker.state()?.plan.id).toBe(id)
  })

  it('drops a waiting plan that finished before its turn, and tells its chat', async () => {
    const env = setup()
    const first = await draft(env.store)
    const second = await draft(env.store)
    const notify = vi.fn()
    await env.broker.offer(first.id, OWNER)
    await env.broker.offer(second.id, OWNER, notify)
    env.store.move(second.id, OWNER, 'cancelled')
    env.broker.refresh()
    expect(env.broker.state()?.waiting).toBe(0)
    expect(notify).toHaveBeenLastCalledWith('cancelled')
  })

  it('sends the state only when it changes, including when the window arms and Ink locks', async () => {
    const env = setup()
    const { id } = await draft(env.store)
    await env.broker.offer(id, OWNER)
    const count = env.states.length
    env.broker.refresh()
    expect(env.states.length).toBe(count)
    expect(env.states.at(-1)?.armed).toBe(false)
    env.tick(ARM_DELAY_MS)
    env.broker.refresh()
    env.lock()
    env.broker.refresh()
    expect(env.states.slice(count).map((state) => [state?.armed, state?.unlocked])).toEqual([
      [true, true],
      [true, false],
    ])
  })
})
