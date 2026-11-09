import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import type { PlanIntent } from '../../shared/plan'
import { planHash } from './hash'
import { createPlanStore, MAX_PLANS, PLAN_TTL_MS, PLANS_PER_MINUTE, type BuildSteps } from './store'

const OWN: Account[] = [{ chain: 'near', path: "m/44'/397'/0'", address: 'a'.repeat(64) }]
const SEND: PlanIntent = { outcome: 'send', asset: 'NEAR', amount: '1.5', chain: 'near', to: 'alice.near', toAsset: null, toChain: null }
const TYPED = ['send 1.5 NEAR to alice.near']

function setup(buildSteps?: BuildSteps) {
  let time = Date.parse('2026-11-08T00:00:00.000Z')
  let tick = 1_000
  let ids = 0
  const store = createPlanStore({
    buildSteps,
    now: () => new Date(time),
    monotonic: () => tick,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  })
  const make = (intent: Partial<PlanIntent> = {}, owner = 'chat-1', typed = TYPED) =>
    store.create({ intent: { ...SEND, ...intent }, createdBy: 'agent', owner, own: OWN, typed })
  return {
    store,
    make,
    /** Real time passing: both clocks move. */
    advance: (ms: number) => ((time += ms), (tick += ms)),
    /** Someone sets the wall clock; the monotonic one doesn't notice. */
    setClock: (ms: number) => (time += ms),
  }
}

const ok = <T extends object>(result: ({ ok: true } & T) | { ok: false }): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result)}`)
  return result
}

describe('making a plan', () => {
  it('gives a draft whose hash covers its fixed core', async () => {
    const { make } = setup()
    const { plan } = ok(await make())
    expect(plan.status).toBe('draft')
    expect(plan.hash).toBe(planHash(plan.core))
    expect(plan.core).toMatchObject({
      hashVersion: 1,
      createdBy: 'agent',
      createdAt: '2026-11-08T00:00:00.000Z',
      expiresAt: '2026-11-08T00:30:00.000Z',
      intent: SEND,
      recipient: { address: 'alice.near', why: 'typed' },
      summary: 'Send 1.5 NEAR on near to alice.near',
      steps: [],
    })
  })

  it('freezes the core, so nothing holding it can change what was hashed', async () => {
    const { make } = setup()
    const { plan } = ok(await make())
    expect(() => ((plan.core.intent as { to: string }).to = 'mallory.near')).toThrow(TypeError)
    expect(() => ((plan.core as { summary: string }).summary = 'Send 1.5 NEAR to a friend')).toThrow(TypeError)
    expect(plan.core.intent.to).toBe('alice.near')
  })

  it('gives every plan its own id and hash, even for the same request', async () => {
    const { make } = setup()
    const [one, two] = [ok(await make()).plan, ok(await make()).plan]
    expect(one.id).not.toBe(two.id)
    expect(one.hash).not.toBe(two.hash)
  })

  it('refuses a recipient the person never typed and that isn’t theirs', async () => {
    const { make } = setup()
    expect(await make({ to: 'mallory.near' })).toEqual({ ok: false, reason: 'recipient-not-allowed' })
    expect(await make({ outcome: 'swap', toAsset: 'USDC', to: 'mallory.near' })).toEqual({ ok: false, reason: 'recipient-not-allowed' })
    expect(await make({ outcome: 'stake', to: 'evil-pool.near' })).toEqual({ ok: false, reason: 'recipient-not-allowed' })
  })

  it('allows sending to the person’s own address, typed or not', async () => {
    const { make } = setup()
    expect(ok(await make({ to: OWN[0]!.address }, 'chat-1', [])).plan.core.recipient).toEqual({ address: OWN[0]!.address, why: 'own' })
  })

  it('checks a swap’s own address on the chain the funds land on', async () => {
    const { make } = setup()
    const swap = { outcome: 'swap' as const, asset: 'USDC', chain: 'base', toAsset: 'NEAR', to: OWN[0]!.address }
    expect(ok(await make({ ...swap, toChain: 'near' }, 'chat-1', [])).plan.core.recipient?.why).toBe('own')
    expect(await make({ ...swap, toChain: 'solana' }, 'chat-1', [])).toEqual({ ok: false, reason: 'recipient-not-allowed' })
    // With no target chain, a swap lands on the chain it starts from.
    expect(await make({ ...swap, toChain: null }, 'chat-1', [])).toEqual({ ok: false, reason: 'recipient-not-allowed' })
  })

  it('leaves a swap with no address paying the person', async () => {
    const { make } = setup()
    const { plan } = ok(await make({ outcome: 'swap', to: null, toAsset: 'USDC', toChain: 'base' }))
    expect(plan.core.recipient).toBeNull()
    expect(plan.core.summary).toBe('Swap 1.5 NEAR on near to USDC on base')
  })

  it.each([
    ['zero', { amount: '0' }],
    ['zero with decimals', { amount: '0.000' }],
    ['a negative amount', { amount: '-1' }],
    ['a leading zero', { amount: '01' }],
    ['a dangling point', { amount: '1.' }],
    ['an exponent', { amount: '1e3' }],
    ['a word', { amount: 'all' }],
    ['an amount past 2^256', { amount: '1'.repeat(80) }],
    ['no asset', { asset: '' }],
    ['an address with a line break', { to: 'alice.near\nTo: mallory.near' }],
    ['an asset with a space', { asset: 'NEAR to mallory' }],
    ['a lookalike letter', { chain: 'nеar' }],
    ['an overlong field', { toChain: 'x'.repeat(257), outcome: 'swap' as const, toAsset: 'USDC', to: null }],
    ['a send with nobody to pay', { to: null }],
    ['a swap with nothing to get', { outcome: 'swap' as const, to: null, toAsset: null }],
  ])('refuses %s', async (_name, change) => {
    const { make } = setup()
    expect(await make(change)).toEqual({ ok: false, reason: 'bad-request' })
  })

  it(`makes at most ${PLANS_PER_MINUTE} plans a minute for one chat, and lets others go on`, async () => {
    const { make, advance } = setup()
    for (let i = 0; i < PLANS_PER_MINUTE; i++) ok(await make())
    expect(await make()).toEqual({ ok: false, reason: 'too-many' })
    ok(await make({}, 'chat-2'))
    advance(60_000)
    ok(await make())
  })

  it('makes room by dropping finished plans, and refuses when none is finished', async () => {
    const { store, make, advance } = setup()
    const ids: string[] = []
    for (let i = 0; i < MAX_PLANS; i++) {
      ids.push(ok(await make({}, `chat-${i}`)).plan.id)
    }
    expect(await make({}, 'another')).toEqual({ ok: false, reason: 'too-many' })
    ok(store.move(ids[0]!, 'chat-0', 'cancelled'))
    ok(await make({}, 'another'))
    expect(store.get(ids[0]!, 'chat-0')).toBeNull()
    advance(PLAN_TTL_MS)
    // Expired plans are finished too.
    ok(await make({}, 'and-another'))
  })
})

describe('a plan’s steps', () => {
  const STEP = { chain: 'near', action: 'transfer', fields: { signerId: 'a'.repeat(64), publicKey: 'ed25519:x', receiverId: 'alice.near', deposit: '1500000000000000000000000' } }

  it('come from the chain module, inside the hash and frozen', async () => {
    const asked: unknown[] = []
    const { make } = setup(async (intent, own) => (asked.push([intent, own]), { ok: true, steps: [STEP] }))
    const { plan } = ok(await make())
    expect(plan.core.steps).toEqual([STEP])
    expect(plan.hash).toBe(planHash(plan.core))
    expect(() => ((plan.core.steps[0]!.fields as Record<string, string>).receiverId = 'mallory.near')).toThrow(TypeError)
    expect(asked).toEqual([[SEND, OWN]])
  })

  it('are only built for a plan that passed every check', async () => {
    let built = 0
    const { make } = setup(async () => (built++, { ok: true, steps: [] }))
    await make({ to: 'mallory.near' })
    await make({ amount: '0' })
    expect(built).toBe(0)
  })

  it('make no plan when the chain module says it can’t go through, and still count toward the limit', async () => {
    const { store, make } = setup(async () => ({ ok: false, reason: 'insufficient-funds' }))
    for (let i = 0; i < PLANS_PER_MINUTE; i++) expect(await make()).toEqual({ ok: false, reason: 'insufficient-funds' })
    expect(await make()).toEqual({ ok: false, reason: 'too-many' })
    expect(store.get('00000000-0000-4000-8000-000000000001', 'chat-1')).toBeNull()
  })

  it('keep the store’s limit when plans are made while steps are built', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { make } = setup(async () => (await gate, { ok: true, steps: [] }))
    const waiting = Array.from({ length: MAX_PLANS + 1 }, (_, i) => make({}, `chat-${i}`))
    release()
    const results = await Promise.all(waiting)
    expect(results.filter((result) => result.ok)).toHaveLength(MAX_PLANS)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: 'too-many' }])
  })
})

describe('reading and moving a plan', () => {
  it('shows a plan only to the chat that made it', async () => {
    const { store, make } = setup()
    const { plan } = ok(await make())
    expect(store.get(plan.id, 'chat-1')?.hash).toBe(plan.hash)
    expect(store.get(plan.id, 'chat-2')).toBeNull()
    expect(store.move(plan.id, 'chat-2', 'cancelled')).toEqual({ ok: false, reason: 'not-found' })
    expect(store.get('no-such-plan', 'chat-1')).toBeNull()
  })

  it('cancels a draft, and nothing moves it after that', async () => {
    const { store, make } = setup()
    const { plan } = ok(await make())
    expect(ok(store.move(plan.id, 'chat-1', 'cancelled')).plan.status).toBe('cancelled')
    expect(store.move(plan.id, 'chat-1', 'cancelled')).toEqual({ ok: false, reason: 'cannot-move', status: 'cancelled' })
    expect(store.move(plan.id, 'chat-1', 'awaiting_review')).toEqual({ ok: false, reason: 'cannot-move', status: 'cancelled' })
  })

  it('moves only the way the status table allows', async () => {
    const { store, make } = setup()
    const { plan } = ok(await make())
    expect(store.move(plan.id, 'chat-1', 'approved')).toEqual({ ok: false, reason: 'cannot-move', status: 'draft' })
    expect(store.move(plan.id, 'chat-1', 'signing')).toEqual({ ok: false, reason: 'cannot-move', status: 'draft' })
    expect(ok(store.move(plan.id, 'chat-1', 'awaiting_review')).plan.status).toBe('awaiting_review')
    expect(ok(store.move(plan.id, 'chat-1', 'approved')).plan.status).toBe('approved')
    expect(store.move(plan.id, 'chat-1', 'nonsense' as 'draft')).toEqual({ ok: false, reason: 'not-found' })
  })

  it('reads a plan past its time as expired, and then won’t cancel it', async () => {
    const { store, make, advance } = setup()
    const { plan } = ok(await make())
    advance(PLAN_TTL_MS - 1)
    expect(store.get(plan.id, 'chat-1')?.status).toBe('draft')
    advance(1)
    expect(store.get(plan.id, 'chat-1')?.status).toBe('expired')
    expect(store.move(plan.id, 'chat-1', 'cancelled')).toEqual({ ok: false, reason: 'cannot-move', status: 'expired' })
  })

  it('stays expired when the wall clock is set back after it expired', async () => {
    const { store, make, advance, setClock } = setup()
    const draft = ok(await make()).plan
    const approved = ok(await make()).plan
    ok(store.move(approved.id, 'chat-1', 'awaiting_review'))
    ok(store.move(approved.id, 'chat-1', 'approved'))
    advance(PLAN_TTL_MS)
    expect([store.get(draft.id, 'chat-1')?.status, store.get(approved.id, 'chat-1')?.status]).toEqual(['expired', 'expired'])
    setClock(-60_000)
    expect([store.get(draft.id, 'chat-1')?.status, store.get(approved.id, 'chat-1')?.status]).toEqual(['expired', 'expired'])
    expect(store.move(draft.id, 'chat-1', 'awaiting_review')).toEqual({ ok: false, reason: 'cannot-move', status: 'expired' })
    expect(store.move(approved.id, 'chat-1', 'signing')).toEqual({ ok: false, reason: 'cannot-move', status: 'expired' })
  })

  it('stays expired when a wall clock that ran ahead is corrected back', async () => {
    const { store, make, setClock } = setup()
    const { plan } = ok(await make())
    setClock(PLAN_TTL_MS)
    expect(store.get(plan.id, 'chat-1')?.status).toBe('expired')
    setClock(-PLAN_TTL_MS)
    expect(store.get(plan.id, 'chat-1')?.status).toBe('expired')
    expect(store.move(plan.id, 'chat-1', 'awaiting_review')).toEqual({ ok: false, reason: 'cannot-move', status: 'expired' })
  })

  it('expires on time even when the wall clock was set back before anyone looked', async () => {
    const { store, make, advance, setClock } = setup()
    const { plan } = ok(await make())
    setClock(-60 * 60_000)
    advance(PLAN_TTL_MS - 1)
    expect(store.get(plan.id, 'chat-1')?.status).toBe('draft')
    advance(1)
    expect(store.get(plan.id, 'chat-1')?.status).toBe('expired')
    expect(store.move(plan.id, 'chat-1', 'awaiting_review')).toEqual({ ok: false, reason: 'cannot-move', status: 'expired' })
  })

  it('keeps the per-minute limit when the wall clock jumps ahead', async () => {
    const { make, setClock } = setup()
    for (let i = 0; i < PLANS_PER_MINUTE; i++) ok(await make())
    setClock(60_000)
    expect(await make()).toEqual({ ok: false, reason: 'too-many' })
  })

  it('keeps the same hash however often it’s read', async () => {
    const { store, make } = setup()
    const { plan } = ok(await make())
    ok(store.move(plan.id, 'chat-1', 'awaiting_review'))
    expect(store.get(plan.id, 'chat-1')?.hash).toBe(plan.hash)
  })
})
