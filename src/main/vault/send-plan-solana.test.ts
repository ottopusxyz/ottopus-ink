import { ed25519 } from '@noble/curves/ed25519.js'
import { base58 } from '@scure/base'
import { describe, expect, it, vi } from 'vitest'
import type { Account } from '../../shared/accounts'
import type { PlanIntent } from '../../shared/plan'
import { associatedTokenAccount, solanaTransferStep, TOKEN_ACCOUNT_RENT, TOKEN_PROGRAM, type SolanaTransfer } from '../../shared/solana/transaction'
import type { LiveInputs, SignedStep, VaultResult } from '../../shared/vault'
import type { NearRpc } from '../near/rpc'
import { createPlanStore } from '../plans/store'
import { describeForReview } from '../review/describe'
import { buildSolanaSend } from '../solana/build'
import { SolanaRpcError, type SolanaAccount, type SolanaRpc } from '../solana/rpc'
import { createPlanSender } from './send-plan'

/** Test keys only. */
const FROM = base58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(7)))
const TO = base58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(9)))
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const OWN: Account[] = [{ chain: 'solana', path: "m/44'/501'/0'/0'", address: FROM }]
const OWNER = 'chat-1'
const INTENT: PlanIntent = { outcome: 'send', asset: 'USDC', amount: '6', chain: 'solana', to: TO, toAsset: null, toChain: null }
const TRANSFER: SolanaTransfer = { from: FROM, to: TO, token: USDC, amount: 6_000_000n, symbol: 'USDC', decimals: 6 }
const SIGNATURE = '5'.repeat(88)
const SIGNED: SignedStep = { signed: new Uint8Array([1, 2, 3]), transactionId: SIGNATURE }
const BLOCKHASH = base58.encode(new Uint8Array(32).fill(3))
const LISTED = [{ assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', symbol: 'USDC', decimals: 6, blockchain: 'sol', contract: USDC, usd: 1 }]

/** A token account's data holding `amount`, and a mint's with `decimals`. */
const tokenAccount = (amount: bigint): SolanaAccount => {
  const data = new Uint8Array(165)
  new DataView(data.buffer).setBigUint64(64, amount, true)
  return { owner: TOKEN_PROGRAM, lamports: TOKEN_ACCOUNT_RENT, data }
}
const mint = (decimals: number, owner = TOKEN_PROGRAM): SolanaAccount => {
  const data = new Uint8Array(82)
  data[44] = decimals
  data[45] = 1
  return { owner, lamports: 1n, data }
}

/** A chain where the sender holds 0.1 SOL and 50 USDC, and the recipient has no USDC account yet. */
function fakeSolana(change: Partial<Record<keyof SolanaRpc, unknown>> = {}, accounts: Record<string, SolanaAccount | null> = {}) {
  const held: Record<string, SolanaAccount | null> = { [USDC]: mint(6), [associatedTokenAccount(FROM, USDC)]: tokenAccount(50_000_000n), ...accounts }
  const rpc = {
    balance: vi.fn(async (address: string) => (address === FROM ? 100_000_000n : 0n)),
    account: vi.fn(async (address: string) => held[address] ?? null),
    latestBlockhash: vi.fn(async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1_150n })),
    blockHeight: vi.fn(async () => 1_000n),
    send: vi.fn(async () => SIGNATURE),
    status: vi.fn(async () => ({ ok: true })),
    ...change,
  }
  return rpc as unknown as SolanaRpc & typeof rpc
}

async function setup({ solana = fakeSolana(), answer = async (): Promise<VaultResult<{ signed: SignedStep[] }>> => ({ ok: true, signed: [SIGNED] }), clock = (): number => 0 }: { solana?: SolanaRpc; answer?: () => Promise<VaultResult<{ signed: SignedStep[] }>>; clock?: () => number } = {}) {
  const store = createPlanStore({ buildSteps: async () => ({ ok: true, steps: [solanaTransferStep(TRANSFER)] }) })
  const made = await store.create({ intent: INTENT, createdBy: 'ui', owner: OWNER, own: OWN, typed: [`send 6 USDC to ${TO} on solana`] })
  if (!made.ok) throw new Error(made.reason)
  store.move(made.plan.id, OWNER, 'awaiting_review')
  store.move(made.plan.id, OWNER, 'approved')
  const vault = { sign: vi.fn<(plan: unknown, hash: string, live: LiveInputs[]) => Promise<VaultResult<{ signed: SignedStep[] }>>>(answer) }
  const confirmed: string[] = []
  const sender = createPlanSender({ store, vault, rpc: {} as NearRpc, solanaRpc: solana, onConfirmed: (_plan, id) => confirmed.push(id), now: clock, wait: async () => undefined })
  return { store, id: made.plan.id, solana, vault, sender, confirmed }
}

/** The most this transfer's fees can take while the recipient has no USDC account: the signature, the priority fee and the account's rent. */
const MAX_FEE = 13_000n + TOKEN_ACCOUNT_RENT

/** A clock that moves ten seconds each time it's read, so a wait for the chain runs out. */
const ticking = () => {
  let time = 0
  return () => (time += 10_000)
}

describe('building a Solana send', () => {
  it('sends USDC by symbol, read from its mint, from the wallet’s own address', async () => {
    const built = await buildSolanaSend(INTENT, OWN, { rpc: fakeSolana(), tokens: async () => LISTED })
    expect(built).toEqual({ ok: true, steps: [solanaTransferStep(TRANSFER)] })
    expect(await buildSolanaSend({ ...INTENT, asset: 'SOL', amount: '0.01' }, OWN, { rpc: fakeSolana(), tokens: async () => LISTED })).toMatchObject({ ok: true, steps: [{ fields: { token: 'native', amount: '10000000' } }] })
  })

  it('refuses what the chain would turn down or lose', async () => {
    const tokens = async () => LISTED
    expect(await buildSolanaSend({ ...INTENT, amount: '60' }, OWN, { rpc: fakeSolana(), tokens })).toEqual({ ok: false, reason: 'insufficient-funds' })
    // Not enough SOL left for the recipient's new token account.
    expect(await buildSolanaSend(INTENT, OWN, { rpc: fakeSolana({ balance: vi.fn(async () => 1_000_000n) }), tokens })).toEqual({ ok: false, reason: 'insufficient-funds' })
    expect(await buildSolanaSend(INTENT, OWN, { rpc: fakeSolana({}, { [TO]: tokenAccount(1n) }), tokens })).toEqual({ ok: false, reason: 'bad-address' })
    expect(await buildSolanaSend(INTENT, OWN, { rpc: fakeSolana({}, { [USDC]: mint(6, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') }), tokens })).toEqual({ ok: false, reason: 'no-route' })
    expect(await buildSolanaSend(INTENT, OWN, { rpc: fakeSolana({}, { [USDC]: mint(9) }), tokens })).toEqual({ ok: false, reason: 'chain-unavailable' })
    expect(await buildSolanaSend({ ...INTENT, asset: 'SOL', amount: '0.0001' }, OWN, { rpc: fakeSolana(), tokens })).toEqual({ ok: false, reason: 'bad-request' })
    expect(await buildSolanaSend({ ...INTENT, to: '0xBbEC2620Cb01adae3f96e1fa39f997f06BFb7Ca0' }, OWN, { rpc: fakeSolana(), tokens })).toEqual({ ok: false, reason: 'bad-address' })
    expect(await buildSolanaSend(INTENT, OWN, { rpc: fakeSolana({ account: vi.fn(async () => Promise.reject(new SolanaRpcError('unavailable', 'down'))) }), tokens })).toEqual({ ok: false, reason: 'chain-unavailable' })
  })
})

describe('sending an approved Solana plan', () => {
  it('shows exactly the transfer for review, with the most its fees could take', async () => {
    const { store, id } = await setup()
    const review = describeForReview(store.get(id, OWNER)!, '', MAX_FEE)
    expect(review).toMatchObject({ kind: 'send', chain: 'Solana', network: 'Solana mainnet', feeAsset: 'SOL', from: FROM, to: TO, toKind: 'solana', amount: '6', asset: 'USDC', maxFee: '0.00205228', maxFeeYocto: MAX_FEE.toString(), maxTotal: '0.00205228' })
    expect(review?.actions[0]?.summary).toContain(`Send 6 USDC (mint ${USDC}) to ${TO} on Solana`)
  })

  it('signs it with a recent blockhash, sends it, and records that the chain ran it', async () => {
    const { id, solana, vault, sender, confirmed } = await setup()
    expect(await sender.send(id, OWNER, MAX_FEE)).toMatchObject({ ok: true, transactionId: SIGNATURE, plan: { status: 'confirmed' } })
    expect(vault.sign.mock.calls[0]?.[2]).toEqual([{ recentBlockhash: BLOCKHASH }])
    expect(solana.send).toHaveBeenCalledWith(SIGNED.signed)
    expect(confirmed).toEqual([SIGNATURE])
  })

  it('signs nothing, and keeps the plan approved, when the fees could now take more than was shown', async () => {
    const { store, id, vault, sender } = await setup()
    expect(await sender.send(id, OWNER, 13_000n)).toMatchObject({ ok: false, reason: 'fee-rose', status: 'approved' })
    expect(vault.sign).not.toHaveBeenCalled()
    expect(store.get(id, OWNER)?.status).toBe('approved')
  })

  it('fails a transaction the chain turned away, or one that ran and failed', async () => {
    const refused = await setup({ solana: fakeSolana({ send: vi.fn(async () => Promise.reject(new SolanaRpcError('rejected', 'simulation failed'))) }) })
    expect(await refused.sender.send(refused.id, OWNER, MAX_FEE)).toMatchObject({ ok: true, plan: { status: 'failed' } })
    const ranAndFailed = await setup({ solana: fakeSolana({ status: vi.fn(async () => ({ ok: false })) }) })
    expect(await ranAndFailed.sender.send(ranAndFailed.id, OWNER, MAX_FEE)).toMatchObject({ ok: true, plan: { status: 'failed' } })
    expect(ranAndFailed.confirmed).toEqual([])
  })

  it('fails one whose blockhash expired before the chain showed it, since it can never land', async () => {
    const heights = [1_000n, 1_151n]
    const { id, sender } = await setup({ solana: fakeSolana({ status: vi.fn(async () => null), blockHeight: vi.fn(async () => heights.shift() ?? 1_151n) }) })
    expect(await sender.send(id, OWNER, MAX_FEE)).toMatchObject({ ok: true, plan: { status: 'failed' } })
  })

  it('leaves one with no answer submitted, and holds the address’s next send until it settles', async () => {
    const status = vi.fn<SolanaRpc['status']>(async () => null)
    const send = vi.fn<SolanaRpc['send']>(async () => Promise.reject(new SolanaRpcError('unavailable', 'down')))
    const blockHeight = vi.fn<SolanaRpc['blockHeight']>(async () => 1_000n)
    const { store, id, sender } = await setup({ solana: fakeSolana({ status, send, blockHeight }), clock: ticking() })
    expect(await sender.send(id, OWNER, MAX_FEE)).toMatchObject({ ok: true, plan: { status: 'submitted' } })
    const next = await store.create({ intent: INTENT, createdBy: 'ui', owner: OWNER, own: OWN, typed: [`send 6 USDC to ${TO} on solana`] })
    if (!next.ok) throw new Error(next.reason)
    store.move(next.plan.id, OWNER, 'awaiting_review')
    store.move(next.plan.id, OWNER, 'approved')
    expect(await sender.send(next.plan.id, OWNER, MAX_FEE)).toMatchObject({ ok: false, reason: 'earlier-pending', status: 'approved' })
    // Once its blockhash is too old for it to land, the next can go.
    blockHeight.mockResolvedValue(1_151n)
    send.mockResolvedValue(SIGNATURE)
    status.mockResolvedValue({ ok: true })
    expect(await sender.send(next.plan.id, OWNER, MAX_FEE)).toMatchObject({ ok: true, plan: { status: 'confirmed' } })
  })
})

describe('a swap the wallet pays on Solana', () => {
  const NEAR_ID = 'a'.repeat(64)
  const EVM = '0x1111111111111111111111111111111111111111'
  const DEPOSIT = base58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(5)))
  const own: Account[] = [{ chain: 'near', path: "m/44'/397'/0'", address: NEAR_ID }, { chain: 'evm', path: "m/44'/60'/0'/0/0", address: EVM }, ...OWN]
  const listed = [...LISTED, { assetId: 'nep141:base-usdc.omft.near', symbol: 'USDC', decimals: 6, blockchain: 'base', contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', usd: 1 }]
  const SWAP: PlanIntent = { outcome: 'swap', asset: 'USDC', amount: '6', chain: 'solana', to: null, toAsset: 'USDC', toChain: 'base' }
  const NOW = Date.parse('2026-11-14T12:00:00Z')

  async function built(solana = fakeSolana(), depositAddress = DEPOSIT) {
    const { buildOneClickSwap } = await import('../routes/swap-plan')
    const asked: import('../routes/one-click').OneClickQuoteRequest[] = []
    const result = await buildOneClickSwap(SWAP, own, {
      tokens: async () => listed,
      held: async () => new Map(),
      solanaRpc: solana,
      quote: async (request) => (
        asked.push(request),
        { ok: true, quote: { amountIn: request.amount, amountOut: 5_980_000n, minAmountOut: 5_920_000n, amountInUsd: 6, amountOutUsd: 5.98, seconds: 40, withdrawFee: 0n, feeBps: 20, depositAddress, depositMemo: null, deadline: new Date(request.deadline) } }
      ),
      fits: async () => null,
      now: () => NOW,
    })
    return { result, asked }
  }

  it('sends the USDC from the wallet’s Solana address to the deposit address there, with a refund back to it', async () => {
    const { result, asked } = await built()
    if (!result.ok) throw new Error(result.reason)
    expect(asked[0]).toMatchObject({ originAsset: LISTED[0]?.assetId, destinationAsset: 'nep141:base-usdc.omft.near', amount: 6_000_000n, depositType: 'ORIGIN_CHAIN', refundTo: FROM, recipient: EVM })
    expect(result.steps).toEqual([solanaTransferStep({ ...TRANSFER, to: DEPOSIT })])
    expect(result.swap).toMatchObject({ payFrom: 'solana', sendSymbol: 'USDC', sendDecimals: '6', sendToken: USDC, refundTo: FROM, depositAddress: DEPOSIT })
  })

  it('is shown for review only while the transfer and the terms agree', async () => {
    const { result } = await built()
    if (!result.ok || !('swap' in result) || !result.swap) throw new Error('no swap')
    const store = createPlanStore({ buildSteps: async () => result })
    const made = await store.create({ intent: SWAP, createdBy: 'ui', owner: OWNER, own, typed: [] })
    if (!made.ok) throw new Error(made.reason)
    const review = describeForReview(store.get(made.plan.id, OWNER)!, '', MAX_FEE)
    expect(review).toMatchObject({ kind: 'swap', chain: 'Solana', to: EVM, toKind: 'other-chain', swap: { from: 'solana', send: '6 USDC', refundTo: FROM, getChain: 'Base' } })
    const tampered = { ...result, swap: { ...result.swap, amountIn: '5000000' } }
    const other = createPlanStore({ buildSteps: async () => tampered })
    const again = await other.create({ intent: SWAP, createdBy: 'ui', owner: OWNER, own, typed: [] })
    if (!again.ok) throw new Error(again.reason)
    expect(describeForReview(other.get(again.plan.id, OWNER)!, '', MAX_FEE)).toBeNull()
  })

  it('refuses a deposit address that isn’t a Solana one, and more USDC than the address holds', async () => {
    expect((await built(fakeSolana(), 'd'.repeat(64))).result).toEqual({ ok: false, reason: 'chain-unavailable' })
    expect((await built(fakeSolana({}, { [associatedTokenAccount(FROM, USDC)]: tokenAccount(1_000_000n) }))).result).toEqual({ ok: false, reason: 'insufficient-funds' })
  })
})

describe('a payment with a part paid on Solana', () => {
  const NEAR_ID = 'a'.repeat(64)
  const EVM = '0x1111111111111111111111111111111111111111'
  const SOL_DEPOSIT = base58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(5)))
  const NEAR_DEPOSIT = 'd'.repeat(64)
  const own: Account[] = [{ chain: 'near', path: "m/44'/397'/0'", address: NEAR_ID }, { chain: 'evm', path: "m/44'/60'/0'/0/0", address: EVM }, ...OWN]
  const USDC_BASE = { assetId: 'nep141:base-usdc.omft.near', symbol: 'USDC', decimals: 6, blockchain: 'base', contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', usd: 1 }
  const PAY: PlanIntent = { outcome: 'pay', asset: 'USDC', amount: '5', chain: null, to: null, toAsset: null, toChain: 'base' }

  it('sends the Solana part from the wallet’s own address, then pays the total out, and is shown for review', async () => {
    const { buildPayment, legsOfStep } = await import('../routes/pay-plan')
    const built = await buildPayment(PAY, own, {
      tokens: async () => [...LISTED, USDC_BASE],
      held: async () => new Map([[`wallet:${LISTED[0]?.assetId}`, 50_000_000n]]),
      solanaRpc: fakeSolana(),
      evmRpc: () => {
        throw new Error('no EVM leg here')
      },
      // A dollar for a dollar, plus 2% on an exact output.
      quote: async (request) => {
        const amountIn = request.swapType === 'EXACT_OUTPUT' ? (request.amount * 102n) / 100n : request.amount
        const amountOut = request.swapType === 'EXACT_OUTPUT' ? request.amount : (request.amount * 99n) / 100n
        const depositAddress = request.dry ? null : request.depositType === 'INTENTS' ? NEAR_DEPOSIT : SOL_DEPOSIT
        return { ok: true, quote: { amountIn, amountOut, minAmountOut: amountOut, amountInUsd: null, amountOutUsd: null, seconds: 20, withdrawFee: 0n, feeBps: 1, depositAddress, depositMemo: null, deadline: request.dry ? null : new Date(Date.now() + 3 * 60 * 60_000) } }
      },
      fits: async () => null,
    })
    if (!built.ok) throw new Error(built.reason)
    const [leg, payout] = built.swaps ?? []
    expect(leg).toMatchObject({ payFrom: 'solana', sendToken: USDC, refundTo: FROM, depositAddress: SOL_DEPOSIT, recipient: NEAR_ID, getChain: 'intents' })
    expect(payout).toMatchObject({ role: 'payout', recipient: EVM, getChain: 'base', amountOut: '5000000' })
    expect(built.steps.map((step) => step.chain)).toEqual(['solana', 'near'])
    expect(built.steps[0]).toEqual(solanaTransferStep({ ...TRANSFER, to: SOL_DEPOSIT, amount: BigInt(leg?.amountIn ?? '0') }))
    const core = { steps: built.steps, swaps: built.swaps }
    expect([legsOfStep(core, 0), legsOfStep(core, 1)]).toEqual([[0], [1]])

    const store = createPlanStore({ buildSteps: async () => built })
    const made = await store.create({ intent: PAY, createdBy: 'ui', owner: OWNER, own, typed: [] })
    if (!made.ok) throw new Error(made.reason)
    const review = describeForReview(store.get(made.plan.id, OWNER)!, '', null, [13_000n, 10n ** 21n])
    expect(review).toMatchObject({ kind: 'pay', chain: 'Solana and NEAR', legs: [{ from: 'solana', fromPlace: 'Solana', refundTo: FROM }], stepFees: [{ chain: 'Solana', feeAsset: 'SOL', maxFee: '0.000013' }, { chain: 'NEAR', feeAsset: 'NEAR' }], publicKey: 'ed25519' })
  })
})
