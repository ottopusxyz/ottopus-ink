import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it, vi } from 'vitest'
import type { Account } from '../../shared/accounts'
import { encodeSignedTransaction, encodeTransfer, nearPublicKey, nearTransferStep, transactionId } from '../../shared/near/transaction'
import type { PlanIntent, PlanStatus, PlanStep } from '../../shared/plan'
import type { LiveInputs, SignedStep, VaultResult } from '../../shared/vault'
import { createNearRpc, NearRpcError, type NearRpc } from '../near/rpc'
import { createPlanStore } from '../plans/store'
import { createPlanSender } from './send-plan'

const FROM = 'a'.repeat(64)
const KEY = nearPublicKey(hexToBytes(FROM))
const OWN: Account[] = [{ chain: 'near', path: "m/44'/397'/0'", address: FROM }]
const OWNER = 'chat-1'
const INTENT: PlanIntent = { outcome: 'send', asset: 'NEAR', amount: '1', chain: 'near', to: 'alice.near', toAsset: null, toChain: null }
const STEP = nearTransferStep({ signerId: FROM, publicKey: KEY, receiverId: 'alice.near', deposit: '1000000000000000000000000' })

const NONCE = 41n
const BLOCK = new Uint8Array(32).fill(9)
const UNSIGNED = encodeTransfer({ signerId: FROM, publicKey: hexToBytes(FROM), nonce: NONCE + 1n, receiverId: 'alice.near', blockHash: BLOCK, deposit: 10n ** 24n })
const SIGNED: SignedStep = { signed: encodeSignedTransaction(UNSIGNED, new Uint8Array(64)), transactionId: transactionId(UNSIGNED) }

/** NEAR's protocol 88 fees, as rpc.test.ts reads them. */
const FEES = {
  minGasPurchasePrice: 1_000_000_000n,
  receipt: { send: 108_059_500_000n, exec: 108_059_500_000n },
  transfer: { send: 115_123_062_500n, exec: 115_123_062_500n },
  createAccount: { send: 500_000_000_000n, exec: 7_200_000_000_000n },
  addFullAccessKey: { send: 101_765_125_000n, exec: 101_765_125_000n },
}

/** A chain where the sender holds 5 NEAR and alice.near exists, with any call changed. */
function fakeRpc(change: Partial<Record<keyof NearRpc, unknown>> = {}) {
  const rpc = {
    chainId: vi.fn(async () => 'mainnet'),
    viewAccount: vi.fn(async (id: string) => (id === FROM ? { amount: 5n * 10n ** 24n, locked: 0n, storageUsage: 100n } : { amount: 1n, locked: 0n, storageUsage: 100n })),
    viewAccessKey: vi.fn(async () => ({ nonce: NONCE, blockHash: BLOCK })),
    gasPrice: vi.fn(async () => 100_000_000n),
    protocolFees: vi.fn(async () => FEES),
    callView: vi.fn(),
    sendTransaction: vi.fn(async () => ({ transactionId: SIGNED.transactionId, ok: true, failure: null })),
    transactionStatus: vi.fn(),
    ...change,
  }
  return rpc as unknown as NearRpc & typeof rpc
}

function fakeVault(answer: () => Promise<VaultResult<{ signed: SignedStep[] }>> = async () => ({ ok: true, signed: [SIGNED] })) {
  return { sign: vi.fn<(plan: unknown, hash: string, live: LiveInputs[]) => Promise<VaultResult<{ signed: SignedStep[] }>>>(answer) }
}

/** A store holding one plan, moved along to the status given, and a sender over it. */
async function setup({ status = 'approved', steps = [STEP], rpc = fakeRpc(), vault = fakeVault() }: { status?: PlanStatus; steps?: PlanStep[]; rpc?: ReturnType<typeof fakeRpc>; vault?: ReturnType<typeof fakeVault> } = {}) {
  const store = createPlanStore({ buildSteps: async () => ({ ok: true, steps }) })
  const made = await store.create({ intent: INTENT, createdBy: 'ui', owner: OWNER, own: OWN, typed: ['send 1 NEAR to alice.near'] })
  if (!made.ok) throw new Error(made.reason)
  const id = made.plan.id
  const path: PlanStatus[] = ['awaiting_review', 'approved']
  for (const next of path.slice(0, status === 'draft' ? 0 : status === 'awaiting_review' ? 1 : 2)) store.move(id, OWNER, next)
  if (!['draft', 'awaiting_review', 'approved'].includes(status)) store.move(id, OWNER, status)
  return { store, id, rpc, vault, sender: createPlanSender({ store, vault, rpc }) }
}

/** Another approved plan in the same store, as the person might approve one straight after the first. */
async function approvedAnother(store: Awaited<ReturnType<typeof setup>>['store']): Promise<string> {
  const made = await store.create({ intent: INTENT, createdBy: 'ui', owner: OWNER, own: OWN, typed: ['send 1 NEAR to alice.near'] })
  if (!made.ok) throw new Error(made.reason)
  store.move(made.plan.id, OWNER, 'awaiting_review')
  store.move(made.plan.id, OWNER, 'approved')
  return made.plan.id
}

describe('sending an approved plan', () => {
  it('signs it under the approved hash with the next nonce and a recent block, sends it, and records NEAR’s outcome', async () => {
    const { store, id, rpc, vault, sender } = await setup()
    const approved = store.get(id, OWNER)!
    const result = await sender.send(id, OWNER)
    expect(result).toMatchObject({ ok: true, transactionId: SIGNED.transactionId, plan: { status: 'confirmed' } })
    expect(vault.sign).toHaveBeenCalledWith(approved.core, approved.hash, [{ nonce: (NONCE + 1n).toString(), blockHash: bytesToHex(BLOCK) }])
    expect(rpc.viewAccessKey).toHaveBeenCalledWith(FROM, KEY)
    expect(rpc.sendTransaction).toHaveBeenCalledWith(SIGNED.signed)
  })

  it('signs only what is approved', async () => {
    for (const status of ['draft', 'awaiting_review', 'cancelled', 'expired', 'signing'] as const) {
      const { id, vault, rpc, sender } = await setup({ status })
      expect(await sender.send(id, OWNER), status).toMatchObject({ ok: false, reason: 'cannot-move', status })
      expect(vault.sign).not.toHaveBeenCalled()
      expect(rpc.sendTransaction).not.toHaveBeenCalled()
    }
  })

  it('finds only the owner’s own plan', async () => {
    const { id, vault, sender } = await setup()
    expect(await sender.send(id, 'chat-2')).toEqual({ ok: false, reason: 'not-found' })
    expect(await sender.send('no-such-plan', OWNER)).toEqual({ ok: false, reason: 'not-found' })
    expect(vault.sign).not.toHaveBeenCalled()
  })

  it('sends nothing but a single NEAR transfer', async () => {
    const other: PlanStep = { chain: 'evm', action: 'transfer', fields: { to: '0x0' } }
    for (const steps of [[], [other], [STEP, STEP], [{ ...STEP, fields: { ...STEP.fields, deposit: '1.5' } }]]) {
      const { id, vault, sender } = await setup({ steps })
      expect(await sender.send(id, OWNER)).toMatchObject({ ok: false, reason: 'bad-request', status: 'approved' })
      expect(vault.sign).not.toHaveBeenCalled()
    }
  })

  describe('leaves it approved, unsigned, when the chain says it can’t go through now', () => {
    const cases: [string, Partial<Record<keyof NearRpc, unknown>>, string][] = [
      ['the RPC is on another network', { chainId: async () => 'testnet' }, 'wrong-network'],
      ['the balance no longer covers it', { viewAccount: async () => ({ amount: 10n ** 24n, locked: 0n, storageUsage: 100n }) }, 'insufficient-funds'],
      ['the recipient no longer exists', { viewAccount: async (id: string) => (id === FROM ? { amount: 5n * 10n ** 24n, locked: 0n, storageUsage: 100n } : null) }, 'recipient-unknown'],
      ['the account has no key yet', { viewAccessKey: async () => null }, 'insufficient-funds'],
      ['no RPC answers', { viewAccessKey: async () => Promise.reject(new NearRpcError('unavailable', 'down')) }, 'chain-unavailable'],
    ]
    it.each(cases)('%s', async (_name, change, reason) => {
      const { store, id, vault, rpc, sender } = await setup({ rpc: fakeRpc(change) })
      expect(await sender.send(id, OWNER)).toEqual({ ok: false, reason, status: 'approved' })
      expect(store.get(id, OWNER)?.status).toBe('approved')
      expect(vault.sign).not.toHaveBeenCalled()
      expect(rpc.sendTransaction).not.toHaveBeenCalled()
    })
  })

  it('checks the fee against today’s gas price, not the one the plan was made at', async () => {
    // At this price the fee ceiling for a named account is about 8.9 NEAR, past the 4 NEAR left after the deposit.
    const { id, vault, sender } = await setup({ rpc: fakeRpc({ gasPrice: async () => 10n ** 16n }) })
    expect(await sender.send(id, OWNER)).toMatchObject({ ok: false, reason: 'insufficient-funds' })
    expect(vault.sign).not.toHaveBeenCalled()
  })

  it('doesn’t sign a plan cancelled while the chain was asked', async () => {
    let cancel = () => {}
    const rpc = fakeRpc({
      viewAccessKey: async () => {
        cancel()
        return { nonce: NONCE, blockHash: BLOCK }
      },
    })
    const { store, id, vault, sender } = await setup({ rpc })
    cancel = () => void store.move(id, OWNER, 'cancelled')
    expect(await sender.send(id, OWNER)).toMatchObject({ ok: false, reason: 'cannot-move', status: 'cancelled' })
    expect(vault.sign).not.toHaveBeenCalled()
  })

  it('fails the plan, and sends nothing, when the signer won’t sign it', async () => {
    for (const reason of ['locked', 'plan-mismatch', 'refused', 'signer-stopped'] as const) {
      const { store, id, rpc, sender } = await setup({ vault: fakeVault(async () => ({ ok: false, reason })) })
      expect(await sender.send(id, OWNER)).toEqual({ ok: false, reason, status: 'failed' })
      expect(store.get(id, OWNER)?.status).toBe('failed')
      expect(rpc.sendTransaction).not.toHaveBeenCalled()
    }
    // Anything else the signer could answer is a refusal too.
    const { sender, id } = await setup({ vault: fakeVault(async () => ({ ok: false, reason: 'bad-input' })) })
    expect(await sender.send(id, OWNER)).toMatchObject({ ok: false, reason: 'refused' })
  })

  it('sends nothing if the signer answers with other than one signed transaction', async () => {
    for (const signed of [[], [SIGNED, SIGNED]]) {
      const { id, rpc, sender } = await setup({ vault: fakeVault(async () => ({ ok: true, signed })) })
      expect(await sender.send(id, OWNER)).toMatchObject({ ok: false, reason: 'refused', status: 'failed' })
      expect(rpc.sendTransaction).not.toHaveBeenCalled()
    }
  })

  it('records a send that NEAR ran and failed, or turned away, as failed', async () => {
    for (const sendTransaction of [async () => ({ transactionId: SIGNED.transactionId, ok: false, failure: 'NotEnoughBalance' }), async () => Promise.reject(new NearRpcError('rejected', 'InvalidNonce'))]) {
      const { id, sender } = await setup({ rpc: fakeRpc({ sendTransaction }) })
      expect(await sender.send(id, OWNER)).toMatchObject({ ok: true, transactionId: SIGNED.transactionId, plan: { status: 'failed' } })
    }
  })

  it('leaves it submitted when one RPC lost its answer and the next said the nonce was used', async () => {
    // Through the real client: the first RPC may have sent it, so the second's error is no proof it never ran.
    let calls = 0
    const fetch = (async () => {
      if (calls++ === 0) throw new TypeError('fetch failed')
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: '1', error: { name: 'HANDLER_ERROR', cause: { name: 'INVALID_TRANSACTION', info: {} }, data: { TxExecutionError: { InvalidTxError: { InvalidNonce: {} } } } } }))
    }) as unknown as typeof globalThis.fetch
    const { sendTransaction } = createNearRpc({ urls: ['https://a.example', 'https://b.example'], fetch })
    const { store, id, sender } = await setup({ rpc: fakeRpc({ sendTransaction }) })
    expect(await sender.send(id, OWNER)).toMatchObject({ ok: true, transactionId: SIGNED.transactionId, plan: { status: 'submitted' } })
    expect(calls).toBe(2)
    expect(store.get(id, OWNER)?.status).toBe('submitted')
  })

  it('leaves a send with no answer submitted, since it may still go through', async () => {
    const { store, id, sender } = await setup({ rpc: fakeRpc({ sendTransaction: async () => Promise.reject(new NearRpcError('unavailable', 'timed out')) }) })
    expect(await sender.send(id, OWNER)).toMatchObject({ ok: true, transactionId: SIGNED.transactionId, plan: { status: 'submitted' } })
    expect(store.get(id, OWNER)?.status).toBe('submitted')
  })

  it('signs the next plan above a nonce the chain doesn’t show yet', async () => {
    // The first send gets no answer, or lands while the RPC still reports the old nonce: either way NONCE + 1 is taken.
    for (const sendTransaction of [async () => Promise.reject(new NearRpcError('unavailable', 'timed out')), async () => ({ transactionId: SIGNED.transactionId, ok: true, failure: null })]) {
      const { store, id, vault, sender } = await setup({ rpc: fakeRpc({ sendTransaction }) })
      expect((await sender.send(id, OWNER)).ok).toBe(true)
      const next = await approvedAnother(store)
      expect((await sender.send(next, OWNER)).ok).toBe(true)
      expect(vault.sign.mock.calls.map(([, , live]) => live[0]?.nonce)).toEqual([(NONCE + 1n).toString(), (NONCE + 2n).toString()])
    }
  })

  it('follows the chain’s nonce once it has moved past what Ink signed', async () => {
    let nonce = NONCE
    const { store, id, vault, sender } = await setup({ rpc: fakeRpc({ viewAccessKey: async () => ({ nonce, blockHash: BLOCK }) }) })
    expect((await sender.send(id, OWNER)).ok).toBe(true)
    // Something else, such as another wallet holding this phrase, sent with the key since.
    nonce = NONCE + 10n
    expect((await sender.send(await approvedAnother(store), OWNER)).ok).toBe(true)
    expect(vault.sign.mock.calls.map(([, , live]) => live[0]?.nonce)).toEqual([(NONCE + 1n).toString(), (NONCE + 11n).toString()])
  })

  it('takes no nonce for a plan the signer refused', async () => {
    let refuse = true
    const vault = fakeVault(async () => (refuse ? { ok: false, reason: 'refused' } : { ok: true, signed: [SIGNED] }))
    const { store, id, sender } = await setup({ vault })
    expect((await sender.send(id, OWNER)).ok).toBe(false)
    refuse = false
    expect((await sender.send(await approvedAnother(store), OWNER)).ok).toBe(true)
    expect(vault.sign.mock.calls.map(([, , live]) => live[0]?.nonce)).toEqual([(NONCE + 1n).toString(), (NONCE + 1n).toString()])
  })

  it('sends one plan at a time, so two can’t take the same nonce', async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const vault = fakeVault(async () => {
      await held
      return { ok: true, signed: [SIGNED] }
    })
    const { store, id, sender } = await setup({ vault })
    const second = await store.create({ intent: INTENT, createdBy: 'ui', owner: OWNER, own: OWN, typed: ['send 1 NEAR to alice.near'] })
    if (!second.ok) throw new Error(second.reason)
    store.move(second.plan.id, OWNER, 'awaiting_review')
    store.move(second.plan.id, OWNER, 'approved')

    const first = sender.send(id, OWNER)
    await vi.waitFor(() => expect(vault.sign).toHaveBeenCalled())
    expect(await sender.send(second.plan.id, OWNER)).toEqual({ ok: false, reason: 'busy' })
    release()
    expect((await first).ok).toBe(true)
    // Once the first is done, the next may go.
    expect((await sender.send(second.plan.id, OWNER)).ok).toBe(true)
  })
})
