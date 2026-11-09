import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import type { PlanIntent } from '../../shared/plan'
import type { VaultResult } from '../../shared/vault'
import { agentPlanTools } from './agent-tools'
import { planHash } from '../../shared/plan-hash'
import { createPlanStore } from './store'

const OWN: Account[] = [{ chain: 'near', path: "m/44'/397'/0'", address: 'a'.repeat(64) }]
const SEND: PlanIntent = { outcome: 'send', asset: 'NEAR', amount: '1', chain: 'near', to: 'alice.near', toAsset: null, toChain: null }

function setup(accounts: () => Promise<VaultResult<{ accounts: Account[] }>> = async () => ({ ok: true, accounts: OWN })) {
  const store = createPlanStore()
  const typed: Record<string, string[]> = { 'chat-1': [], 'chat-2': [] }
  const tools = (owner: string) => agentPlanTools({ store, owner, typed: () => typed[owner]!, accounts })
  return { store, typed, tools }
}

describe('an agent chat’s plan tools', () => {
  it('make a draft paying an address the person typed in that chat, marked as the agent’s', async () => {
    const { store, typed, tools } = setup()
    typed['chat-1']!.push('please send 1 NEAR to alice.near')
    const made = await tools('chat-1').create(SEND)
    if (!made.ok) throw new Error(made.reason)
    expect(made.plan).toMatchObject({ status: 'draft', summary: 'Send 1 NEAR on near to alice.near', recipient: { address: 'alice.near', why: 'typed' } })
    const stored = store.get(made.plan.id, 'chat-1')
    expect(stored?.core.createdBy).toBe('agent')
    expect(stored?.hash).toBe(planHash(stored!.core))
  })

  it('refuse an address the person typed in another chat, or never typed', async () => {
    const { typed, tools } = setup()
    typed['chat-2']!.push('send 1 NEAR to alice.near')
    expect(await tools('chat-1').create(SEND)).toEqual({ ok: false, reason: 'recipient-not-allowed' })
    expect(await tools('chat-2').create({ ...SEND, to: 'mallory.near' })).toEqual({ ok: false, reason: 'recipient-not-allowed' })
  })

  it('pay the person’s own address without it being typed', async () => {
    const { tools } = setup()
    const made = await tools('chat-1').create({ ...SEND, to: OWN[0]!.address })
    expect(made.ok && made.plan.recipient).toEqual({ address: OWN[0]!.address, why: 'own' })
  })

  it('say so while the vault is locked or missing, and make nothing', async () => {
    const locked = setup(async () => ({ ok: false, reason: 'locked' }))
    expect(await locked.tools('chat-1').create(SEND)).toEqual({ ok: false, reason: 'locked' })
    const none = setup(async () => ({ ok: false, reason: 'no-vault' }))
    expect(await none.tools('chat-1').create(SEND)).toEqual({ ok: false, reason: 'no-vault' })
    const broken = setup(async () => {
      throw new Error('signer gone')
    })
    expect(await broken.tools('chat-1').create(SEND)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('show and cancel a plan only in the chat that made it', async () => {
    const { typed, tools } = setup()
    typed['chat-1']!.push('to alice.near')
    const made = await tools('chat-1').create(SEND)
    if (!made.ok) throw new Error(made.reason)
    const id = made.plan.id
    expect(await tools('chat-2').get(id)).toEqual({ ok: false, reason: 'not-found' })
    expect(await tools('chat-2').cancel(id)).toEqual({ ok: false, reason: 'not-found' })
    expect((await tools('chat-1').get(id)).ok).toBe(true)
    const cancelled = await tools('chat-1').cancel(id)
    expect(cancelled.ok && cancelled.plan.status).toBe('cancelled')
    expect(await tools('chat-1').cancel(id)).toEqual({ ok: false, reason: 'cannot-move', status: 'cancelled' })
  })
})
