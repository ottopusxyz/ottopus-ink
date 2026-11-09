import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import type { PlanIntent } from '../../shared/plan'
import { planHash } from './hash'
import { createPlanStore, MAX_PLANS, PLAN_TTL_MS, PLANS_PER_MINUTE } from './store'

const OWN: Account[] = [{ chain: 'near', path: "m/44'/397'/0'", address: 'a'.repeat(64) }]
const SEND: PlanIntent = { outcome: 'send', asset: 'NEAR', amount: '1.5', chain: 'near', to: 'alice.near', toAsset: null, toChain: null }
const TYPED = ['send 1.5 NEAR to alice.near']

function setup() {
  let time = Date.parse('2026-11-08T00:00:00.000Z')
  let ids = 0
  const store = createPlanStore({ now: () => new Date(time), newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` })
  const make = (intent: Partial<PlanIntent> = {}, owner = 'chat-1', typed = TYPED) =>
    store.create({ intent: { ...SEND, ...intent }, createdBy: 'agent', owner, own: OWN, typed })
  return { store, make, advance: (ms: number) => (time += ms) }
}

const ok = <T extends object>(result: ({ ok: true } & T) | { ok: false }): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result)}`)
  return result
}

describe('making a plan', () => {
  it('gives a draft whose hash covers its fixed core', () => {
    const { make } = setup()
    const { plan } = ok(make())
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

  it('freezes the core, so nothing holding it can change what was hashed', () => {
    const { make } = setup()
    const { plan } = ok(make())
    expect(() => ((plan.core.intent as { to: string }).to = 'mallory.near')).toThrow(TypeError)
    expect(() => ((plan.core as { summary: string }).summary = 'Send 1.5 NEAR to a friend')).toThrow(TypeError)
    expect(plan.core.intent.to).toBe('alice.near')
  })

  it('gives every plan its own id and hash, even for the same request', () => {
    const { make } = setup()
    const [one, two] = [ok(make()).plan, ok(make()).plan]
    expect(one.id).not.toBe(two.id)
    expect(one.hash).not.toBe(two.hash)
  })

  it('refuses a recipient the person never typed and that isn’t theirs', () => {
    const { make } = setup()
    expect(make({ to: 'mallory.near' })).toEqual({ ok: false, reason: 'recipient-not-allowed' })
    expect(make({ outcome: 'swap', toAsset: 'USDC', to: 'mallory.near' })).toEqual({ ok: false, reason: 'recipient-not-allowed' })
    expect(make({ outcome: 'stake', to: 'evil-pool.near' })).toEqual({ ok: false, reason: 'recipient-not-allowed' })
  })

  it('allows sending to the person’s own address, typed or not', () => {
    const { make } = setup()
    expect(ok(make({ to: OWN[0]!.address }, 'chat-1', [])).plan.core.recipient).toEqual({ address: OWN[0]!.address, why: 'own' })
  })

  it('checks a swap’s own address on the chain the funds land on', () => {
    const { make } = setup()
    const swap = { outcome: 'swap' as const, asset: 'USDC', chain: 'base', toAsset: 'NEAR', to: OWN[0]!.address }
    expect(ok(make({ ...swap, toChain: 'near' }, 'chat-1', [])).plan.core.recipient?.why).toBe('own')
    expect(make({ ...swap, toChain: 'solana' }, 'chat-1', [])).toEqual({ ok: false, reason: 'recipient-not-allowed' })
    // With no target chain, a swap lands on the chain it starts from.
    expect(make({ ...swap, toChain: null }, 'chat-1', [])).toEqual({ ok: false, reason: 'recipient-not-allowed' })
  })

  it('leaves a swap with no address paying the person', () => {
    const { make } = setup()
    const { plan } = ok(make({ outcome: 'swap', to: null, toAsset: 'USDC', toChain: 'base' }))
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
  ])('refuses %s', (_name, change) => {
    const { make } = setup()
    expect(make(change)).toEqual({ ok: false, reason: 'bad-request' })
  })

  it(`makes at most ${PLANS_PER_MINUTE} plans a minute for one chat, and lets others go on`, () => {
    const { make, advance } = setup()
    for (let i = 0; i < PLANS_PER_MINUTE; i++) ok(make())
    expect(make()).toEqual({ ok: false, reason: 'too-many' })
    ok(make({}, 'chat-2'))
    advance(60_000)
    ok(make())
  })

  it('makes room by dropping finished plans, and refuses when none is finished', () => {
    const { store, make, advance } = setup()
    const ids: string[] = []
    for (let i = 0; i < MAX_PLANS; i++) {
      ids.push(ok(make({}, `chat-${i}`)).plan.id)
    }
    expect(make({}, 'another')).toEqual({ ok: false, reason: 'too-many' })
    ok(store.move(ids[0]!, 'chat-0', 'cancelled'))
    ok(make({}, 'another'))
    expect(store.get(ids[0]!, 'chat-0')).toBeNull()
    advance(PLAN_TTL_MS)
    // Expired plans are finished too.
    ok(make({}, 'and-another'))
  })
})

describe('reading and moving a plan', () => {
  it('shows a plan only to the chat that made it', () => {
    const { store, make } = setup()
    const { plan } = ok(make())
    expect(store.get(plan.id, 'chat-1')?.hash).toBe(plan.hash)
    expect(store.get(plan.id, 'chat-2')).toBeNull()
    expect(store.move(plan.id, 'chat-2', 'cancelled')).toEqual({ ok: false, reason: 'not-found' })
    expect(store.get('no-such-plan', 'chat-1')).toBeNull()
  })

  it('cancels a draft, and nothing moves it after that', () => {
    const { store, make } = setup()
    const { plan } = ok(make())
    expect(ok(store.move(plan.id, 'chat-1', 'cancelled')).plan.status).toBe('cancelled')
    expect(store.move(plan.id, 'chat-1', 'cancelled')).toEqual({ ok: false, reason: 'cannot-move', status: 'cancelled' })
    expect(store.move(plan.id, 'chat-1', 'awaiting_review')).toEqual({ ok: false, reason: 'cannot-move', status: 'cancelled' })
  })

  it('moves only the way the status table allows', () => {
    const { store, make } = setup()
    const { plan } = ok(make())
    expect(store.move(plan.id, 'chat-1', 'approved')).toEqual({ ok: false, reason: 'cannot-move', status: 'draft' })
    expect(store.move(plan.id, 'chat-1', 'signing')).toEqual({ ok: false, reason: 'cannot-move', status: 'draft' })
    expect(ok(store.move(plan.id, 'chat-1', 'awaiting_review')).plan.status).toBe('awaiting_review')
    expect(ok(store.move(plan.id, 'chat-1', 'approved')).plan.status).toBe('approved')
    expect(store.move(plan.id, 'chat-1', 'nonsense' as 'draft')).toEqual({ ok: false, reason: 'not-found' })
  })

  it('reads a plan past its time as expired, and then won’t cancel it', () => {
    const { store, make, advance } = setup()
    const { plan } = ok(make())
    advance(PLAN_TTL_MS - 1)
    expect(store.get(plan.id, 'chat-1')?.status).toBe('draft')
    advance(1)
    expect(store.get(plan.id, 'chat-1')?.status).toBe('expired')
    expect(store.move(plan.id, 'chat-1', 'cancelled')).toEqual({ ok: false, reason: 'cannot-move', status: 'expired' })
  })

  it('keeps the same hash however often it’s read', () => {
    const { store, make } = setup()
    const { plan } = ok(make())
    ok(store.move(plan.id, 'chat-1', 'awaiting_review'))
    expect(store.get(plan.id, 'chat-1')?.hash).toBe(plan.hash)
  })
})
