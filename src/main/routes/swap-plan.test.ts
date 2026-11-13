import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import { callsOfStep, WRAP_STORAGE_DEPOSIT } from '../../shared/near/calls'
import type { PlanIntent } from '../../shared/plan'
import { PLAN_TTL_MS } from '../plans/store'
import type { OneClickQuoteRequest, OneClickQuoteResult, OneClickToken } from './one-click'
import { buildOneClickSwap, SWAP_DEADLINE_AFTER_PLAN_MS, type SwapPlanDeps } from './swap-plan'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const NEAR_ID = 'a'.repeat(64)
const EVM = '0x1111111111111111111111111111111111111111'
const DEPOSIT = 'd'.repeat(64)
const OWN: Account[] = [
  { chain: 'near', path: "m/44'/397'/0'", address: NEAR_ID },
  { chain: 'evm', path: "m/44'/60'/0'/0/0", address: EVM },
]
const token = (assetId: string, symbol: string, blockchain: string, decimals = 6): OneClickToken => ({ assetId, symbol, decimals, blockchain, contract: null, usd: 1 })
const TOKENS = [
  token('nep141:wrap.near', 'wNEAR', 'near', 24),
  token('nep141:usdc.near', 'USDC', 'near'),
  token('nep141:base-usdc.omft.near', 'USDC', 'base'),
  token('nep141:xrp.omft.near', 'XRP', 'xrp'),
]
const SWAP: PlanIntent = { outcome: 'swap', asset: 'NEAR', amount: '5', chain: 'near', to: null, toAsset: 'USDC', toChain: 'base' }
const FIVE = 5n * 10n ** 24n

function deps(overrides: Partial<SwapPlanDeps> = {}, answer?: (request: OneClickQuoteRequest) => OneClickQuoteResult) {
  const asked: OneClickQuoteRequest[] = []
  const fitted: unknown[] = []
  const options: SwapPlanDeps = {
    tokens: async () => TOKENS,
    quote: async (request) => {
      asked.push(request)
      return (
        answer?.(request) ?? {
          ok: true,
          quote: {
            amountIn: request.amount,
            amountOut: 17_400_531n,
            minAmountOut: 17_226_525n,
            amountInUsd: 17.4,
            amountOutUsd: 17.39,
            seconds: 22.4,
            withdrawFee: 2400n,
            feeBps: 20,
            depositAddress: DEPOSIT,
            depositMemo: null,
            deadline: new Date(request.deadline),
          },
        }
      )
    },
    fits: async (...args) => (fitted.push(args), null),
    now: () => NOW,
    ...overrides,
  }
  return { options, asked, fitted }
}

describe('building a swap from NEAR through 1Click', () => {
  it('asks for a binding quote paying the person’s own Base address, refunded to their NEAR account', async () => {
    const { options, asked } = deps()
    await buildOneClickSwap(SWAP, OWN, options)
    expect(asked).toEqual([
      {
        originAsset: 'nep141:wrap.near',
        destinationAsset: 'nep141:base-usdc.omft.near',
        amount: FIVE,
        depositType: 'ORIGIN_CHAIN',
        refundTo: NEAR_ID,
        recipient: EVM,
        recipientType: 'DESTINATION_CHAIN',
        dry: false,
        deadline: new Date(NOW + PLAN_TTL_MS + SWAP_DEADLINE_AFTER_PLAN_MS),
        slippageBps: 100,
      },
    ])
  })

  it('makes one transaction to wrap.near: register both, wrap, and send the wNEAR to the deposit address', async () => {
    const { options, fitted } = deps()
    const built = await buildOneClickSwap(SWAP, OWN, options)
    if (!built.ok) throw new Error('expected a plan')
    expect(built.steps).toHaveLength(1)
    expect(callsOfStep(built.steps[0]!)).toMatchObject({
      signerId: NEAR_ID,
      receiverId: 'wrap.near',
      calls: [
        { method: 'storage_deposit', accountId: NEAR_ID },
        { method: 'storage_deposit', accountId: DEPOSIT },
        { method: 'near_deposit', amount: FIVE },
        { method: 'ft_transfer', receiverId: DEPOSIT, amount: FIVE },
      ],
    })
    expect(fitted).toEqual([[NEAR_ID, FIVE + 2n * WRAP_STORAGE_DEPOSIT + 1n, 60n * 10n ** 12n, 4]])
  })

  it('keeps what 1Click promised as the plan’s swap terms, and who it pays', async () => {
    const built = await buildOneClickSwap(SWAP, OWN, deps().options)
    expect(built).toMatchObject({
      ok: true,
      swap: {
        via: '1click',
        depositAddress: DEPOSIT,
        deadline: new Date(NOW + PLAN_TTL_MS + SWAP_DEADLINE_AFTER_PLAN_MS).toISOString(),
        amountIn: FIVE.toString(),
        amountOut: '17400531',
        minAmountOut: '17226525',
        sendSymbol: 'NEAR',
        getSymbol: 'USDC',
        getDecimals: '6',
        getChain: 'base',
        recipient: EVM,
        refundTo: NEAR_ID,
        feeBps: '20',
        seconds: '22',
      },
      payout: { address: EVM, chain: 'evm' },
    })
  })

  it('pays into the person’s Intents balance when asked', async () => {
    const { options, asked } = deps()
    const built = await buildOneClickSwap({ ...SWAP, toChain: 'intents' }, OWN, options)
    expect(asked[0]).toMatchObject({ destinationAsset: 'nep141:usdc.near', recipient: NEAR_ID, recipientType: 'INTENTS' })
    expect(built).toMatchObject({ ok: true, swap: { getChain: 'intents', recipient: NEAR_ID }, payout: { address: NEAR_ID, chain: 'near' } })
  })

  it('refuses a chain where the person has no address of their own', async () => {
    const { options, asked } = deps()
    expect(await buildOneClickSwap({ ...SWAP, toAsset: 'XRP', toChain: 'xrp' }, OWN, options)).toEqual({ ok: false, reason: 'recipient-not-allowed' })
    expect(asked).toEqual([])
  })

  it('leaves anything it doesn’t build yet as a draft, without asking 1Click', async () => {
    const { options, asked } = deps()
    for (const intent of [
      { ...SWAP, outcome: 'send' as const, to: 'alice.near' },
      { ...SWAP, asset: 'USDC', toAsset: 'NEAR', toChain: 'near' },
      { ...SWAP, chain: 'base', asset: 'USDC', toAsset: 'NEAR', toChain: 'near' },
      { ...SWAP, toAsset: 'NEAR', toChain: 'near' },
      { ...SWAP, to: EVM },
    ]) {
      expect(await buildOneClickSwap(intent, OWN, options)).toEqual({ ok: true, steps: [] })
    }
    expect(asked).toEqual([])
  })

  it('makes no plan when 1Click won’t quote it, the wallet can’t cover it, or NEAR can’t be asked', async () => {
    expect(await buildOneClickSwap(SWAP, OWN, deps({}, () => ({ ok: false, reason: 'too-small' })).options)).toEqual({ ok: false, reason: 'no-route' })
    expect(await buildOneClickSwap(SWAP, OWN, deps({}, () => ({ ok: false, reason: 'unavailable' })).options)).toEqual({ ok: false, reason: 'chain-unavailable' })
    expect(await buildOneClickSwap(SWAP, OWN, deps({ fits: async () => 'insufficient-funds' }).options)).toEqual({ ok: false, reason: 'insufficient-funds' })
    expect(await buildOneClickSwap(SWAP, OWN, deps({ fits: async () => Promise.reject(new Error('down')) }).options)).toEqual({ ok: false, reason: 'chain-unavailable' })
    expect(await buildOneClickSwap(SWAP, OWN, deps({ tokens: async () => null }).options)).toEqual({ ok: false, reason: 'chain-unavailable' })
    expect(await buildOneClickSwap({ ...SWAP, amount: '0' }, OWN, deps().options)).toEqual({ ok: false, reason: 'bad-request' })
  })

  it('refuses a deposit address that isn’t a NEAR account, or dies too soon', async () => {
    const quoteWith = (overrides: object) => (request: OneClickQuoteRequest): OneClickQuoteResult => ({
      ok: true,
      quote: { amountIn: request.amount, amountOut: 1n, minAmountOut: 1n, amountInUsd: null, amountOutUsd: null, seconds: 1, withdrawFee: 0n, feeBps: 0, depositAddress: DEPOSIT, depositMemo: null, deadline: new Date(request.deadline), ...overrides },
    })
    expect(await buildOneClickSwap(SWAP, OWN, deps({}, quoteWith({ depositAddress: '0xAbC' })).options)).toEqual({ ok: false, reason: 'chain-unavailable' })
    expect(await buildOneClickSwap(SWAP, OWN, deps({}, quoteWith({ deadline: new Date(NOW + PLAN_TTL_MS) })).options)).toEqual({ ok: false, reason: 'chain-unavailable' })
  })
})
