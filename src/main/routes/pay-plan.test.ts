import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import { evmChainOf } from '../../shared/evm/chains'
import { callsOfStep } from '../../shared/near/calls'
import type { PlanIntent } from '../../shared/plan'
import type { EvmRpc } from '../evm/rpc'
import { createPlanStore, PLAN_TTL_MS } from '../plans/store'
import { describeForReview } from '../review/describe'
import type { OneClickQuoteRequest, OneClickQuoteResult, OneClickToken } from './one-click'
import { buildPayment, legsOfStep, paymentProgress, type PayPlanDeps } from './pay-plan'

const NOW = Date.now()
const NEAR_ID = 'a'.repeat(64)
const EVM = '0x1111111111111111111111111111111111111111'
const SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const OWN: Account[] = [
  { chain: 'near', path: "m/44'/397'/0'", address: NEAR_ID },
  { chain: 'evm', path: "m/44'/60'/0'/0/0", address: EVM },
  { chain: 'solana', path: "m/44'/501'/0'/0'", address: SOL },
]
const USDC_BASE: OneClickToken = { assetId: 'nep141:base-usdc.omft.near', symbol: 'USDC', decimals: 6, blockchain: 'base', contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', usd: 1 }
const USDT_BSC: OneClickToken = { assetId: 'nep141:bnb-usdt.omdep.near', symbol: 'USDT', decimals: 18, blockchain: 'bsc', contract: '0x55d398326f99059ff775485246999027b3197955', usd: 1 }
const USDC_SOL: OneClickToken = { assetId: 'nep141:sol-usdc.omft.near', symbol: 'USDC', decimals: 6, blockchain: 'sol', contract: null, usd: 1 }
const WNEAR: OneClickToken = { assetId: 'nep141:wrap.near', symbol: 'wNEAR', decimals: 24, blockchain: 'near', contract: null, usd: 3 }
const TOKENS = [WNEAR, USDC_BASE, USDT_BSC, USDC_SOL]
const PAY: PlanIntent = { outcome: 'pay', asset: 'USDC', amount: '15', chain: null, to: null, toAsset: null, toChain: 'solana' }
const EVM_DEPOSIT = '0x8f436D184823B77188DE973322278686c3780C2c'
const NEAR_DEPOSIT = 'd'.repeat(64)

/** Each source's decimals, so the fake quotes convert between them at a dollar each. */
const DECIMALS: Record<string, number> = { [USDC_BASE.assetId]: 6, [USDT_BSC.assetId]: 18, [USDC_SOL.assetId]: 6 }
const scale = (raw: bigint, from: number, to: number) => (to >= from ? raw * 10n ** BigInt(to - from) : raw / 10n ** BigInt(from - to))

/** 1Click as a dollar for a dollar, less 1% on an exact input and plus 2% on an exact output. */
function quoteOf(asked: OneClickQuoteRequest[]) {
  return async (request: OneClickQuoteRequest): Promise<OneClickQuoteResult> => {
    asked.push(request)
    const decimals = DECIMALS[request.originAsset] ?? 6
    const exactOut = request.swapType === 'EXACT_OUTPUT'
    const amountIn = exactOut ? (scale(request.amount, 6, decimals) * 102n) / 100n : request.amount
    const amountOut = exactOut ? request.amount : (scale(request.amount, decimals, 6) * 99n) / 100n
    const depositAddress = request.dry ? null : request.depositType === 'INTENTS' ? NEAR_DEPOSIT : EVM_DEPOSIT
    return { ok: true, quote: { amountIn, amountOut, minAmountOut: amountOut, amountInUsd: null, amountOutUsd: null, seconds: 20, withdrawFee: 0n, feeBps: 1, depositAddress, depositMemo: null, deadline: request.dry ? null : new Date(NOW + PLAN_TTL_MS + 60 * 60_000) } }
  }
}

const evmRpc = (): EvmRpc =>
  ({
    chain: evmChainOf('base')!,
    balance: async () => 10n ** 16n,
    tokenBalance: async () => 10n ** 9n,
    decimals: async () => 6,
    symbol: async () => 'USDC',
    estimateGas: async () => 50_000n,
    fees: async () => ({ baseFee: 10_000_000n, tip: 1_000_000n }),
    nonce: async () => 0n,
    l1FeeUpperBound: async () => 0n,
    send: async () => '',
    receipt: async () => null,
  }) as unknown as EvmRpc

function deps(held: Record<string, bigint>, overrides: Partial<PayPlanDeps> = {}) {
  const asked: OneClickQuoteRequest[] = []
  const options: PayPlanDeps = { tokens: async () => TOKENS, held: async () => new Map(Object.entries(held)), quote: quoteOf(asked), fits: async () => null, evmRpc, now: () => NOW, ...overrides }
  return { options, asked }
}

const TWO = { [`wallet:${USDC_BASE.assetId}`]: 10_000_000n, [`intents:${USDT_BSC.assetId}`]: 10n * 10n ** 18n }

describe('building a payment from several sources', () => {
  it('brings exactly what the payout needs into the Intents balance, then pays the total out in one transfer', async () => {
    const { options, asked } = deps(TWO)
    const built = await buildPayment(PAY, OWN, options)
    if (!built.ok) throw new Error(built.reason)
    const swaps = built.swaps ?? []
    const payout = swaps.at(-1)!
    // The payout: exactly 15 USDC out of the Intents balance to the person's own Solana address, quoted first.
    expect(payout).toMatchObject({ role: 'payout', payFrom: 'intents', originAsset: USDC_SOL.assetId, destinationAsset: USDC_SOL.assetId, amountOut: '15000000', minAmountOut: '15000000', recipient: SOL, getChain: 'sol', fromBalance: '0' })
    expect(asked[0]).toMatchObject({ swapType: 'EXACT_OUTPUT', amount: 15_000_000n, depositType: 'INTENTS', recipient: SOL, recipientType: 'DESTINATION_CHAIN', dry: false })
    // The legs: exactly what the payout moves, together, into the person's own Intents balance.
    const legs = swaps.slice(0, -1)
    expect(legs.reduce((sum, leg) => sum + BigInt(leg.amountOut), 0n)).toBe(BigInt(payout.amountIn))
    expect(legs.map((leg) => [leg.payFrom, leg.recipient, leg.getChain, leg.destinationAsset, leg.refundTo])).toEqual([
      ['intents', NEAR_ID, 'intents', USDC_SOL.assetId, NEAR_ID],
      ['evm', NEAR_ID, 'intents', USDC_SOL.assetId, EVM],
    ])
    expect(asked.filter((request) => !request.dry && request.recipient === NEAR_ID).every((request) => request.recipientType === 'INTENTS' && request.swapType === 'EXACT_OUTPUT')).toBe(true)
    // The Intents leg, then the EVM leg, then the payout, which moves exactly what it needs.
    expect(built.steps.map((step) => step.chain)).toEqual(['near', 'evm', 'near'])
    expect(callsOfStep(built.steps[0]!).calls).toEqual([{ method: 'mt_transfer', receiverId: NEAR_DEPOSIT, tokenId: USDT_BSC.assetId, amount: BigInt(legs[0]!.amountIn) }])
    expect(built.steps[1]?.fields).toMatchObject({ chainId: '8453', to: EVM_DEPOSIT, amount: legs[1]!.amountIn })
    expect(callsOfStep(built.steps[2]!).calls).toEqual([{ method: 'mt_transfer', receiverId: NEAR_DEPOSIT, tokenId: USDC_SOL.assetId, amount: BigInt(payout.amountIn) }])
    expect(built.payout).toEqual({ address: SOL, chain: 'solana' })
  })

  it('counts what the Intents balance holds of the token already, and needs no legs when it covers the payout', async () => {
    const some = await buildPayment(PAY, OWN, deps({ ...TWO, [`intents:${USDC_SOL.assetId}`]: 5_000_000n }).options)
    if (!some.ok) throw new Error(some.reason)
    const payout = some.swaps!.at(-1)!
    expect(payout.fromBalance).toBe('5000000')
    expect(some.swaps!.slice(0, -1).reduce((sum, leg) => sum + BigInt(leg.amountOut), 0n)).toBe(BigInt(payout.amountIn) - 5_000_000n)
    const all = await buildPayment(PAY, OWN, deps({ [`intents:${USDC_SOL.assetId}`]: 20_000_000n }).options)
    if (!all.ok) throw new Error(all.reason)
    expect(all.swaps).toHaveLength(1)
    expect(all.steps.map((step) => step.chain)).toEqual(['near'])
  })

  it('refuses what everything held together can’t cover, and a payment with nowhere to land', async () => {
    expect(await buildPayment({ ...PAY, amount: '25' }, OWN, deps(TWO).options)).toEqual({ ok: false, reason: 'insufficient-funds' })
    expect(await buildPayment(PAY, OWN, deps({}).options)).toEqual({ ok: false, reason: 'insufficient-funds' })
    expect(await buildPayment({ ...PAY, toChain: 'moon' }, OWN, deps(TWO).options)).toEqual({ ok: false, reason: 'no-route' })
    expect(await buildPayment({ ...PAY, to: '0xnotsolana' }, OWN, deps(TWO).options)).toEqual({ ok: false, reason: 'bad-address' })
    expect(await buildPayment(PAY, OWN, deps(TWO, { held: async () => null }).options)).toEqual({ ok: false, reason: 'chain-unavailable' })
  })

  it('maps each step to the swaps it pays, the payout last', async () => {
    const built = await buildPayment(PAY, OWN, deps(TWO).options)
    if (!built.ok) throw new Error(built.reason)
    const core = { steps: built.steps, swaps: built.swaps }
    expect([legsOfStep(core, 0), legsOfStep(core, 1), legsOfStep(core, 2)]).toEqual([[0], [1], [2]])
  })

  it('is shown for review only when every step pays its part exactly, with each step’s fee and the one payout', async () => {
    const store = createPlanStore({ buildSteps: (intent, own) => buildPayment(intent, own, deps(TWO).options) })
    const made = await store.create({ intent: PAY, createdBy: 'agent', owner: 'chat', own: OWN, typed: [] })
    if (!made.ok) throw new Error(made.reason)
    const review = describeForReview(made.plan, '', null, [10n ** 21n, 10n ** 12n, 10n ** 21n])
    expect(review).toMatchObject({
      kind: 'pay',
      amount: '15',
      asset: 'USDC',
      to: SOL,
      toWhy: 'own',
      network: 'NEAR mainnet + Base mainnet',
      payChain: { mark: 'solana', name: 'Solana' },
      payout: { get: '15 USDC', fromBalance: null },
      stepFees: [
        { chain: 'NEAR', feeAsset: 'NEAR', maxFee: '0.001' },
        { chain: 'Base', feeAsset: 'ETH', maxFee: '0.000001' },
        { chain: 'NEAR', feeAsset: 'NEAR', maxFee: '0.001' },
      ],
    })
    expect(review?.legs?.map((leg) => leg.fromPlace)).toEqual(['your NEAR Intents balance', 'Base'])
    // Steps out of the order their swaps are followed in, a leg bringing in less, or a payout to anyone else, and it isn't shown.
    const swapped = { ...made.plan, core: { ...made.plan.core, steps: [...made.plan.core.steps].reverse() } }
    expect(describeForReview(swapped, '', null, [null, null, null])).toBeNull()
    const short = { ...made.plan, core: { ...made.plan.core, swaps: made.plan.core.swaps!.map((swap, i) => (i === 0 ? { ...swap, amountOut: '1', minAmountOut: '1' } : swap)) } }
    expect(describeForReview(short, '', null, [null, null, null])).toBeNull()
    const elsewhere = { ...made.plan, core: { ...made.plan.core, swaps: made.plan.core.swaps!.map((swap) => (swap.role === 'payout' ? { ...swap, recipient: 'Elsewhere1111111111111111111111111111111111' } : swap)) } }
    expect(describeForReview(elsewhere, '', null, [null, null, null])).toBeNull()
  })

  it('is refused by the store when a leg pays anyone but the person’s own Intents balance', async () => {
    const store = createPlanStore({
      buildSteps: async (intent, own) => {
        const built = await buildPayment(intent, own, deps(TWO).options)
        return built.ok ? { ...built, swaps: built.swaps!.map((swap, i) => (i === 0 ? { ...swap, recipient: 'b'.repeat(64) } : swap)) } : built
      },
    })
    expect(await store.create({ intent: PAY, createdBy: 'agent', owner: 'chat', own: OWN, typed: [] })).toEqual({ ok: false, reason: 'recipient-not-allowed' })
  })
})

describe('where a payment stands', () => {
  const swaps = [
    { amountOut: '5000000', getDecimals: '6', getSymbol: 'USDC' },
    { amountOut: '10000000', getDecimals: '6', getSymbol: 'USDC' },
  ] as unknown as Parameters<typeof paymentProgress>[0]
  const leg = (stage: 'deposited' | 'swapping' | 'done' | 'refunded' | 'failed' | 'unknown', link: string | null = null) => ({ stage, got: null, refunded: stage === 'refunded' ? '5 USDT' : null, link })

  it('is done with the exact total only once every leg is, and goes as far as the slowest', () => {
    expect(paymentProgress(swaps, [null, null])).toBeNull()
    expect(paymentProgress(swaps, [leg('done'), null])?.stage).toBe('deposited')
    expect(paymentProgress(swaps, [leg('done'), leg('swapping')])?.stage).toBe('swapping')
    expect(paymentProgress(swaps, [leg('done', 'https://solscan.io/tx/a'), leg('done')])).toEqual({ stage: 'done', got: '15 USDC', refunded: null, link: 'https://solscan.io/tx/a' })
  })

  it('fails or is refunded as soon as any leg is', () => {
    expect(paymentProgress(swaps, [leg('done'), leg('failed')])?.stage).toBe('failed')
    expect(paymentProgress(swaps, [leg('refunded'), leg('done')])).toMatchObject({ stage: 'refunded', refunded: '5 USDT' })
  })
})
