import { describe, expect, it, vi } from 'vitest'
import type { Account } from '../../shared/accounts'
import { evmChainOf } from '../../shared/evm/chains'
import { evmTransferStep } from '../../shared/evm/transaction'
import type { PlanIntent } from '../../shared/plan'
import type { LiveInputs, SignedStep, VaultResult } from '../../shared/vault'
import { EvmRpcError, type EvmRpc } from '../evm/rpc'
import type { NearRpc } from '../near/rpc'
import { createPlanStore } from '../plans/store'
import { describeForReview } from '../review/describe'
import { createPlanSender } from './send-plan'

const FROM = '0xBbEC2620Cb01adae3f96e1fa39f997f06BFb7Ca0'
const TO = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const OWN: Account[] = [{ chain: 'evm', path: "m/44'/60'/0'/0/0", address: FROM }]
const OWNER = 'chat-1'
const INTENT: PlanIntent = { outcome: 'send', asset: 'USDC', amount: '10', chain: 'base', to: TO, toAsset: null, toChain: null }
const STEP = evmTransferStep({ chainId: 8453, from: FROM, to: TO, token: USDC, amount: 10_000_000n, gas: 60_000n, symbol: 'USDC', decimals: 6 })
const HASH = `0x${'ab'.repeat(32)}`
const SIGNED: SignedStep = { signed: new Uint8Array([2, 1, 2, 3]), transactionId: HASH }
/** The fees below can't take more than this. */
const MAX_FEE = 60_000n * 21_000_000n + 1_000n

function fakeEvm(change: Partial<Record<keyof EvmRpc, unknown>> = {}) {
  const rpc = {
    chain: evmChainOf('base')!,
    balance: vi.fn(async () => 10n ** 16n),
    tokenBalance: vi.fn(async () => 50_000_000n),
    decimals: vi.fn(async () => 6),
    symbol: vi.fn(async () => 'USDC'),
    estimateGas: vi.fn(async () => 50_000n),
    fees: vi.fn(async () => ({ baseFee: 10_000_000n, tip: 1_000_000n })),
    nonce: vi.fn(async () => 3n),
    l1FeeUpperBound: vi.fn(async () => 1_000n),
    send: vi.fn(async () => HASH),
    receipt: vi.fn(async () => ({ ok: true, fee: 1n })),
    ...change,
  }
  return rpc as unknown as EvmRpc & typeof rpc
}

async function setup({ evm = fakeEvm(), answer = async (): Promise<VaultResult<{ signed: SignedStep[] }>> => ({ ok: true, signed: [SIGNED] }) } = {}) {
  const store = createPlanStore({ buildSteps: async () => ({ ok: true, steps: [STEP] }) })
  const made = await store.create({ intent: INTENT, createdBy: 'ui', owner: OWNER, own: OWN, typed: [`send 10 USDC to ${TO} on base`] })
  if (!made.ok) throw new Error(made.reason)
  store.move(made.plan.id, OWNER, 'awaiting_review')
  store.move(made.plan.id, OWNER, 'approved')
  const vault = { sign: vi.fn<(plan: unknown, hash: string, live: LiveInputs[]) => Promise<VaultResult<{ signed: SignedStep[] }>>>(answer) }
  const confirmed: string[] = []
  const sender = createPlanSender({ store, vault, rpc: {} as NearRpc, evmRpc: () => evm, onConfirmed: (_plan, hash) => confirmed.push(hash), wait: async () => undefined })
  return { store, id: made.plan.id, evm, vault, sender, confirmed }
}

describe('sending an approved EVM plan', () => {
  it('signs it with the next nonce and today’s fee caps, sends it, and records the receipt', async () => {
    const { store, id, evm, vault, sender, confirmed } = await setup()
    expect(await sender.send(id, OWNER, MAX_FEE)).toMatchObject({ ok: true, transactionId: HASH, plan: { status: 'confirmed' } })
    expect(vault.sign.mock.calls[0]?.[2]).toEqual([{ nonce: '3', maxFeePerGas: '21000000', maxPriorityFeePerGas: '1000000' }])
    expect(evm.send).toHaveBeenCalledWith(SIGNED.signed)
    expect(confirmed).toEqual([HASH])
    expect(store.get(id, OWNER)?.status).toBe('confirmed')
  })

  it('asks again when the fees could now cost more than what was approved, and signs nothing', async () => {
    const { id, vault, sender } = await setup()
    expect(await sender.send(id, OWNER, MAX_FEE - 1n)).toMatchObject({ ok: false, reason: 'fee-rose', status: 'approved' })
    expect(vault.sign).not.toHaveBeenCalled()
  })

  it('records a reverted transaction as failed, and one the chain turned away as failed with its nonce free again', async () => {
    const reverted = await setup({ evm: fakeEvm({ receipt: vi.fn(async () => ({ ok: false, fee: 1n })) }) })
    expect(await reverted.sender.send(reverted.id, OWNER, MAX_FEE)).toMatchObject({ ok: true, plan: { status: 'failed' } })
    const refused = await setup({ evm: fakeEvm({ send: vi.fn(async () => Promise.reject(new EvmRpcError('rejected', 'nonce too low'))) }) })
    expect(await refused.sender.send(refused.id, OWNER, MAX_FEE)).toMatchObject({ ok: true, plan: { status: 'failed' } })
  })

  it('leaves a send with no answer submitted, and waits for it before signing another from that address', async () => {
    const { store, id, sender } = await setup({ evm: fakeEvm({ send: vi.fn(async () => Promise.reject(new EvmRpcError('unavailable', 'down'))), nonce: vi.fn(async () => 3n) }) })
    expect(await sender.send(id, OWNER, MAX_FEE)).toMatchObject({ ok: true, plan: { status: 'submitted' } })
    const again = await store.create({ intent: INTENT, createdBy: 'ui', owner: OWNER, own: OWN, typed: [`send 10 USDC to ${TO} on base`] })
    if (!again.ok) throw new Error(again.reason)
    store.move(again.plan.id, OWNER, 'awaiting_review')
    store.move(again.plan.id, OWNER, 'approved')
    expect(await sender.send(again.plan.id, OWNER, MAX_FEE)).toMatchObject({ ok: false, reason: 'earlier-pending' })
  })

  it('refuses when the balance no longer covers it, and when the chain can’t be reached', async () => {
    const poor = await setup({ evm: fakeEvm({ tokenBalance: vi.fn(async () => 1n) }) })
    expect(await poor.sender.send(poor.id, OWNER, MAX_FEE)).toMatchObject({ ok: false, reason: 'insufficient-funds' })
    const down = await setup({ evm: fakeEvm({ fees: vi.fn(async () => Promise.reject(new EvmRpcError('unavailable', 'down'))) }) })
    expect(await down.sender.send(down.id, OWNER, MAX_FEE)).toMatchObject({ ok: false, reason: 'chain-unavailable', status: 'approved' })
  })
})

describe('what the review window shows for an EVM send', () => {
  it('shows the token at its decimals, the chain, its fee coin, and the call in plain words', async () => {
    const { store, id } = await setup()
    expect(describeForReview(store.get(id, OWNER)!, '', MAX_FEE)).toMatchObject({
      kind: 'send',
      network: 'Base mainnet',
      chain: 'Base',
      feeAsset: 'ETH',
      chainMark: 'base',
      explorer: { name: 'basescan.org', tx: 'https://basescan.org/tx/' },
      to: TO,
      toKind: 'evm',
      toWhy: 'typed',
      amount: '10',
      amountYocto: '10000000',
      asset: 'USDC',
      maxFee: '0.000001260000001',
      maxTotal: '0.000001260000001',
      actions: [{ kind: 'FunctionCall', method: 'transfer', amount: '0', summary: `Send 10 USDC to ${TO} on Base, through the token’s contract ${USDC}` }],
    })
  })
})
