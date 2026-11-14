import { hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it, vi } from 'vitest'
import type { Account } from '../../shared/accounts'
import { evmChainOf } from '../../shared/evm/chains'
import { evmTransferStep } from '../../shared/evm/transaction'
import { nearCallStep } from '../../shared/near/calls'
import { nearPublicKey } from '../../shared/near/transaction'
import type { PlanIntent, PlanSwap } from '../../shared/plan'
import type { LiveInputs, SignedStep, VaultResult } from '../../shared/vault'
import type { EvmRpc } from '../evm/rpc'
import type { NearRpc } from '../near/rpc'
import { createPlanStore, PLAN_TTL_MS } from '../plans/store'
import { createPlanSender } from './send-plan'

const NEAR_ID = 'a'.repeat(64)
const EVM = '0xBbEC2620Cb01adae3f96e1fa39f997f06BFb7Ca0'
const SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const OWN: Account[] = [
  { chain: 'near', path: "m/44'/397'/0'", address: NEAR_ID },
  { chain: 'evm', path: "m/44'/60'/0'/0/0", address: EVM },
  { chain: 'solana', path: "m/44'/501'/0'/0'", address: SOL },
]
const OWNER = 'chat-1'
const NEAR_DEPOSIT = 'd'.repeat(64)
const EVM_DEPOSIT = '0x8f436D184823B77188DE973322278686c3780C2c'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const PAY: PlanIntent = { outcome: 'pay', asset: 'USDC', amount: '15', chain: null, to: null, toAsset: null, toChain: 'solana' }

const SOL_USDC = 'nep141:sol-usdc.omft.near'
const PAYOUT_DEPOSIT = 'e'.repeat(64)
const leg = (extra: Partial<PlanSwap>): PlanSwap => ({
  via: '1click',
  depositAddress: NEAR_DEPOSIT,
  deadline: new Date(Date.now() + PLAN_TTL_MS + 60 * 60_000).toISOString(),
  originAsset: 'nep141:bnb-usdt.omdep.near',
  destinationAsset: SOL_USDC,
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
const SWAPS = [
  leg({}),
  leg({ depositAddress: EVM_DEPOSIT, originAsset: 'nep141:base-usdc.omft.near', amountIn: '10200000', amountOut: '10300000', minAmountOut: '10300000', sendSymbol: 'USDC', refundTo: EVM, payFrom: 'evm', sendDecimals: '6', sendChainId: '8453', sendToken: USDC }),
  leg({ depositAddress: PAYOUT_DEPOSIT, originAsset: SOL_USDC, amountIn: '15300000', amountOut: '15000000', minAmountOut: '15000000', sendSymbol: 'USDC', sendDecimals: '6', getChain: 'sol', recipient: SOL, role: 'payout', fromBalance: '0' }),
]
const nearStep = (receiverId: string, tokenId: string, amount: bigint) =>
  nearCallStep({ signerId: NEAR_ID, publicKey: nearPublicKey(hexToBytes(NEAR_ID)), receiverId: 'intents.near', calls: [{ method: 'mt_transfer', receiverId, tokenId, amount }] })
const STEPS = [
  nearStep(NEAR_DEPOSIT, 'nep141:bnb-usdt.omdep.near', 5_100_000_000_000_000_000n),
  evmTransferStep({ chainId: 8453, from: EVM, to: EVM_DEPOSIT, token: USDC, amount: 10_200_000n, gas: 60_000n, symbol: 'USDC', decimals: 6 }),
  nearStep(PAYOUT_DEPOSIT, SOL_USDC, 15_300_000n),
]
const SIGNED: SignedStep[] = [
  { signed: new Uint8Array([1]), transactionId: 'NearTx111' },
  { signed: new Uint8Array([2]), transactionId: `0x${'ab'.repeat(32)}` },
  { signed: new Uint8Array([3]), transactionId: 'NearTx333' },
]
const FEES = [10n ** 23n, 10n ** 13n, 10n ** 23n]

function fakeNear(change: Partial<Record<keyof NearRpc, unknown>> = {}) {
  return {
    chainId: vi.fn(async () => 'mainnet'),
    viewAccount: vi.fn(async () => ({ amount: 5n * 10n ** 24n, locked: 0n, storageUsage: 100n })),
    viewAccessKey: vi.fn(async () => ({ nonce: 41n, blockHash: new Uint8Array(32).fill(9), blockHeight: 1_000n })),
    gasPrice: vi.fn(async () => 100_000_000n),
    sendTransaction: vi.fn(async () => ({ transactionId: 'NearTx111', ok: true, failure: null })),
    ...change,
  } as unknown as NearRpc & { sendTransaction: ReturnType<typeof vi.fn> }
}

function fakeEvm(change: Partial<Record<keyof EvmRpc, unknown>> = {}) {
  return {
    chain: evmChainOf('base')!,
    balance: vi.fn(async () => 10n ** 16n),
    tokenBalance: vi.fn(async () => 50_000_000n),
    fees: vi.fn(async () => ({ baseFee: 10_000_000n, tip: 1_000_000n })),
    nonce: vi.fn(async () => 3n),
    l1FeeUpperBound: vi.fn(async () => 0n),
    send: vi.fn(async () => `0x${'ab'.repeat(32)}`),
    receipt: vi.fn(async () => ({ ok: true, fee: 1n })),
    ...change,
  } as unknown as EvmRpc & { send: ReturnType<typeof vi.fn> }
}

async function setup({ near = fakeNear(), evm = fakeEvm() } = {}) {
  const store = createPlanStore({ buildSteps: async () => ({ ok: true, steps: STEPS, swaps: SWAPS, payout: { address: SOL, chain: 'solana' } }) })
  const made = await store.create({ intent: PAY, createdBy: 'agent', owner: OWNER, own: OWN, typed: [] })
  if (!made.ok) throw new Error(made.reason)
  store.move(made.plan.id, OWNER, 'awaiting_review')
  store.move(made.plan.id, OWNER, 'approved')
  const vault = { sign: vi.fn<(plan: unknown, hash: string, live: LiveInputs[]) => Promise<VaultResult<{ signed: SignedStep[] }>>>(async () => ({ ok: true, signed: SIGNED })) }
  const stepsDone: [number, string][] = []
  const sender = createPlanSender({ store, vault, rpc: near, evmRpc: () => evm, onStepConfirmed: (_plan, step, id) => stepsDone.push([step, id]), wait: async () => undefined })
  return { store, id: made.plan.id, near, evm, vault, sender, stepsDone }
}

describe('sending an approved payment', () => {
  it('signs every step together, sends the legs in order, and keeps the payout until they land', async () => {
    const { store, id, near, evm, vault, sender, stepsDone } = await setup()
    expect(await sender.send(id, OWNER, FEES)).toMatchObject({ ok: true, plan: { status: 'submitted' } })
    expect(vault.sign.mock.calls[0]?.[2]).toEqual([
      { nonce: '42', blockHash: '09'.repeat(32) },
      { nonce: '3', maxFeePerGas: '21000000', maxPriorityFeePerGas: '1000000' },
      { nonce: '43', blockHash: '09'.repeat(32) },
    ])
    expect(near.sendTransaction.mock.calls.map((call) => call[0])).toEqual([SIGNED[0]!.signed])
    expect(evm.send).toHaveBeenCalledWith(SIGNED[1]!.signed)
    expect(stepsDone.map(([step]) => step)).toEqual([0, 1])
    expect(sender.holds(id)).toBe(true)
    // Once the legs land, the payout goes, and the plan is confirmed.
    expect(await sender.releasePayout(id)).toMatchObject({ ok: true, plan: { status: 'confirmed' }, transactionId: 'NearTx333' })
    expect(near.sendTransaction.mock.calls.map((call) => call[0])).toEqual([SIGNED[0]!.signed, SIGNED[2]!.signed])
    expect(stepsDone.map(([step]) => step)).toEqual([0, 1, 2])
    expect(sender.holds(id)).toBe(false)
    expect(store.get(id, OWNER)?.status).toBe('confirmed')
  })

  it('holds back other NEAR sends from the key while a payout waits, and drops the payout if a leg fails', async () => {
    const { store, id, near, sender } = await setup()
    await sender.send(id, OWNER, FEES)
    const next = await store.create({ intent: PAY, createdBy: 'agent', owner: OWNER, own: OWN, typed: [] })
    if (!next.ok) throw new Error(next.reason)
    store.move(next.plan.id, OWNER, 'awaiting_review')
    store.move(next.plan.id, OWNER, 'approved')
    expect(await sender.send(next.plan.id, OWNER, FEES)).toMatchObject({ ok: false, reason: 'earlier-pending' })
    sender.dropPayout(id)
    expect(store.get(id, OWNER)?.status).toBe('failed')
    expect(sender.holds(id)).toBe(false)
    expect(near.sendTransaction).toHaveBeenCalledTimes(1)
  })

  it('stops at a leg that fails, and never sends the rest or keeps the payout', async () => {
    const { id, evm, sender, stepsDone } = await setup({ near: fakeNear({ sendTransaction: vi.fn(async () => ({ transactionId: 'NearTx111', ok: false, failure: 'x' })) }) })
    expect(await sender.send(id, OWNER, FEES)).toMatchObject({ ok: true, plan: { status: 'failed' } })
    expect(evm.send).not.toHaveBeenCalled()
    expect(stepsDone).toEqual([])
    expect(sender.holds(id)).toBe(false)
  })

  it('signs nothing when any step’s fees could now cost more than its own limit, or the limits don’t match the steps', async () => {
    const { id, vault, sender } = await setup()
    expect(await sender.send(id, OWNER, [FEES[0]!, 1n, FEES[2]!])).toMatchObject({ ok: false, reason: 'fee-rose', status: 'approved' })
    expect(await sender.send(id, OWNER, [FEES[0]!])).toMatchObject({ ok: false, reason: 'bad-request' })
    expect(await sender.send(id, OWNER, 10n ** 30n)).toMatchObject({ ok: false, reason: 'bad-request' })
    expect(vault.sign).not.toHaveBeenCalled()
  })
})
