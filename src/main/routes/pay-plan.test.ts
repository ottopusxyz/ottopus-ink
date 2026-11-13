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
const DECIMALS: Record<string, number> = { [USDC_BASE.assetId]: 6, [USDT_BSC.assetId]: 18 }
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
  it('pays exactly the amount in exact parts, the Intents part in one NEAR call and the EVM part in one transfer', async () => {
    const { options, asked } = deps(TWO)
    const built = await buildPayment(PAY, OWN, options)
    if (!built.ok) throw new Error(built.reason)
    const total = (built.swaps ?? []).reduce((sum, swap) => sum + BigInt(swap.amountOut), 0n)
    expect(total).toBe(15_000_000n)
    expect(built.swaps?.map((swap) => [swap.payFrom, swap.amountOut === swap.minAmountOut, swap.recipient])).toEqual([
      ['intents', true, SOL],
      ['evm', true, SOL],
    ])
    expect(built.steps.map((step) => step.chain)).toEqual(['near', 'evm'])
    expect(callsOfStep(built.steps[0]!).calls).toEqual([{ method: 'mt_transfer', receiverId: NEAR_DEPOSIT, tokenId: USDT_BSC.assetId, amount: BigInt(built.swaps![0]!.amountIn) }])
    expect(built.steps[1]?.fields).toMatchObject({ chainId: '8453', to: EVM_DEPOSIT, amount: built.swaps![1]!.amountIn })
    // Every binding quote is an exact output to the person's own Solana address; refunds go back where each part came from.
    expect(asked.filter((request) => !request.dry).every((request) => request.swapType === 'EXACT_OUTPUT' && request.recipient === SOL)).toBe(true)
    expect(built.swaps?.map((swap) => swap.refundTo)).toEqual([NEAR_ID, EVM])
    expect(built.payout).toEqual({ address: SOL, chain: 'solana' })
  })

  it('pays from one source when it covers the amount', async () => {
    const built = await buildPayment({ ...PAY, amount: '5' }, OWN, deps(TWO).options)
    if (!built.ok) throw new Error(built.reason)
    expect(built.swaps).toHaveLength(1)
    expect(built.swaps?.[0]?.amountOut).toBe('5000000')
  })

  it('refuses what everything held together can’t cover, and a payment with nowhere to land', async () => {
    expect(await buildPayment({ ...PAY, amount: '25' }, OWN, deps(TWO).options)).toEqual({ ok: false, reason: 'insufficient-funds' })
    expect(await buildPayment(PAY, OWN, deps({}).options)).toEqual({ ok: false, reason: 'insufficient-funds' })
    expect(await buildPayment({ ...PAY, toChain: 'moon' }, OWN, deps(TWO).options)).toEqual({ ok: false, reason: 'no-route' })
    expect(await buildPayment({ ...PAY, to: '0xnotsolana' }, OWN, deps(TWO).options)).toEqual({ ok: false, reason: 'bad-address' })
    expect(await buildPayment(PAY, OWN, deps(TWO, { held: async () => null }).options)).toEqual({ ok: false, reason: 'chain-unavailable' })
  })

  it('maps each step to the legs it pays', async () => {
    const built = await buildPayment(PAY, OWN, deps(TWO).options)
    if (!built.ok) throw new Error(built.reason)
    const core = { steps: built.steps, swaps: built.swaps }
    expect([legsOfStep(core, 0), legsOfStep(core, 1), legsOfStep(core, 2)]).toEqual([[0], [1], []])
  })

  it('is shown for review only when every step pays its leg exactly, with each step’s fee', async () => {
    const store = createPlanStore({ buildSteps: (intent, own) => buildPayment(intent, own, deps(TWO).options) })
    const made = await store.create({ intent: PAY, createdBy: 'agent', owner: 'chat', own: OWN, typed: [] })
    if (!made.ok) throw new Error(made.reason)
    const review = describeForReview(made.plan, '', null, [10n ** 21n, 10n ** 12n])
    expect(review).toMatchObject({
      kind: 'pay',
      amount: '15',
      asset: 'USDC',
      to: SOL,
      toWhy: 'own',
      network: 'NEAR mainnet + Base mainnet',
      payChain: { mark: 'solana', name: 'Solana' },
      stepFees: [
        { chain: 'NEAR', feeAsset: 'NEAR', maxFee: '0.001' },
        { chain: 'Base', feeAsset: 'ETH', maxFee: '0.000001' },
      ],
    })
    expect(review?.legs?.map((leg) => leg.fromPlace)).toEqual(['your NEAR Intents balance', 'Base'])
    // Steps in another order than their legs are followed by, or a leg's amount changed, and it isn't shown.
    const swapped = { ...made.plan, core: { ...made.plan.core, steps: [...made.plan.core.steps].reverse() } }
    expect(describeForReview(swapped, '', null, [null, null])).toBeNull()
    const changed = { ...made.plan, core: { ...made.plan.core, swaps: made.plan.core.swaps!.map((swap, i) => (i === 0 ? { ...swap, amountIn: '1' } : swap)) } }
    expect(describeForReview(changed, '', null, [null, null])).toBeNull()
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
