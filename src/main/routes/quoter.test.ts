import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import type { Portfolio, PortfolioResult, TokenHolding } from '../../shared/portfolio'
import type { OneClickQuote, OneClickQuoteRequest, OneClickQuoteResult, OneClickToken } from './one-click'
import { createQuoter, holdingsOf, type QuoterDeps } from './quoter'

const token = (assetId: string, symbol: string, blockchain: string, decimals = 6): OneClickToken => ({ assetId, symbol, decimals, blockchain, contract: null, usd: 1 })
const WNEAR = token('nep141:wrap.near', 'wNEAR', 'near', 24)
const BASE_USDC = token('nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', 'USDC', 'base')
const XRP = token('nep245:v2_1.omni.hot.tg:1100_xrp', 'XRP', 'xrp')
const TOKENS = [WNEAR, BASE_USDC, XRP]

const ACCOUNTS: Account[] = [
  { chain: 'near', path: "m/44'/397'/0'", address: 'a'.repeat(64) },
  { chain: 'evm', path: "m/44'/60'/0'/0/0", address: '0x1111111111111111111111111111111111111111' },
]

const intentsUsdc = (amount: string): TokenHolding => ({
  id: `intents:${BASE_USDC.assetId}`,
  group: 'intents',
  network: 'intents',
  networkName: 'NEAR Intents',
  contract: BASE_USDC.assetId,
  origin: 'Base',
  symbol: 'USDC',
  decimals: 6,
  amount,
  price: { usd: 1, change24h: null },
  usdValue: Number(amount),
  countedUsd: Number(amount),
  trust: 'reviewed',
})

const portfolio = (available: string, tokens: TokenHolding[] = []): PortfolioResult => ({
  ok: true,
  near: { accountId: 'a'.repeat(64), onChain: true, available, staked: '0', storage: '0', pools: [], stakingComplete: true },
  nearPrice: { usd: 3.5, change24h: null },
  tokens,
  zerion: 'off',
  zerionVia: null,
  unread: [],
  unpriced: 0,
  totalUsd: 0,
  readAt: 0,
  gaps: [],
} satisfies Portfolio & { ok: true })

const QUOTE: OneClickQuote = { amountIn: 0n, amountOut: 17_400_531n, minAmountOut: 17_226_525n, amountInUsd: 17.4, amountOutUsd: 17.39, seconds: 22, withdrawFee: 2400n, feeBps: 20, depositAddress: null, depositMemo: null, deadline: null }

function quoter(overrides: Partial<QuoterDeps> = {}, answer: (request: OneClickQuoteRequest) => OneClickQuoteResult = (request) => ({ ok: true, quote: { ...QUOTE, amountIn: request.amount } })) {
  const asked: OneClickQuoteRequest[] = []
  const quote = createQuoter({
    accounts: async () => ({ ok: true, accounts: ACCOUNTS }),
    portfolio: async () => portfolio('10'),
    tokens: async () => TOKENS,
    quote: async (request) => {
      asked.push(request)
      return answer(request)
    },
    nearFee: async () => 450_000_000_000_000_000_000n,
    now: () => Date.parse('2026-11-13T12:00:00Z'),
    ...overrides,
  })
  return { quote, asked }
}

describe('quoting a payment', () => {
  it('gives a direct NEAR transfer with its most network fee, asking 1Click nothing', async () => {
    const { quote, asked } = quoter()
    expect(await quote({ fromAsset: 'NEAR', toAsset: 'NEAR', amount: '1' })).toEqual({
      ok: true,
      kind: 'direct',
      send: { amount: '1', symbol: 'NEAR', chain: 'near' },
      fee: '0.00045',
      held: { amount: '10', symbol: 'NEAR', chain: 'near' },
      enough: true,
    })
    expect(asked).toEqual([])
  })

  it('quotes NEAR to Base through Intents, paid to the wallet’s own Base address and refunded to its NEAR account', async () => {
    const { quote, asked } = quoter()
    const outcome = await quote({ fromAsset: 'NEAR', toAsset: 'USDC', toChain: 'base', amount: '5' })
    expect(asked).toEqual([
      {
        originAsset: 'nep141:wrap.near',
        destinationAsset: BASE_USDC.assetId,
        amount: 5n * 10n ** 24n,
        depositType: 'ORIGIN_CHAIN',
        refundTo: 'a'.repeat(64),
        recipient: '0x1111111111111111111111111111111111111111',
        recipientType: 'DESTINATION_CHAIN',
        dry: true,
        deadline: new Date('2026-11-13T12:30:00Z'),
        slippageBps: 100,
      },
    ])
    expect(outcome).toEqual({
      ok: true,
      kind: 'intents',
      source: 'wallet',
      send: { amount: '5', symbol: 'NEAR', chain: 'near', usd: 17.4 },
      get: { amount: '17.400531', symbol: 'USDC', chain: 'base', usd: 17.39 },
      least: { amount: '17.226525', symbol: 'USDC', chain: 'base' },
      withdrawFee: { amount: '0.0024', symbol: 'USDC', chain: 'base' },
      feeBps: 20,
      seconds: 22,
      paidTo: 'own-address',
      signsOrigin: true,
      held: { amount: '10', symbol: 'NEAR', chain: 'near' },
      enough: true,
      compared: false,
    })
  })

  it('quotes into the Intents balance where the wallet has no address of its own', async () => {
    const { quote, asked } = quoter()
    const outcome = await quote({ fromAsset: 'NEAR', toAsset: 'XRP', amount: '5' })
    expect(asked[0]).toMatchObject({ recipient: 'a'.repeat(64), recipientType: 'INTENTS' })
    expect(outcome).toMatchObject({ ok: true, paidTo: 'no-own-address' })
  })

  it('pays from the Intents balance with an Intents deposit and refund', async () => {
    const { quote, asked } = quoter({ portfolio: async () => portfolio('0', [intentsUsdc('20')]) })
    const outcome = await quote({ fromAsset: 'USDC', fromChain: 'intents', toAsset: 'NEAR', toChain: 'near', amount: '10' })
    expect(asked[0]).toMatchObject({ originAsset: BASE_USDC.assetId, depositType: 'INTENTS', refundTo: 'a'.repeat(64), recipient: 'a'.repeat(64), recipientType: 'DESTINATION_CHAIN' })
    // Base USDC's own chain is one Ink signs on now, though here the Intents balance pays.
    expect(outcome).toMatchObject({ ok: true, source: 'intents', signsOrigin: true, enough: true })
  })

  it('quotes both the wallet and the Intents balance when both cover it, and keeps the better', async () => {
    const both = { portfolio: async () => portfolio('10', [{ ...intentsUsdc('0'), id: 'intents:nep141:wrap.near', contract: 'nep141:wrap.near', symbol: 'wNEAR', decimals: 24, amount: '20' }]) }
    const { quote, asked } = quoter(both, (request) => ({ ok: true, quote: { ...QUOTE, amountIn: request.amount, amountOut: request.depositType === 'INTENTS' ? 17_500_000n : 17_400_000n } }))
    const outcome = await quote({ fromAsset: 'NEAR', toAsset: 'USDC', toChain: 'base', amount: '5' })
    expect(asked.map((request) => request.depositType).sort()).toEqual(['INTENTS', 'ORIGIN_CHAIN'])
    expect(outcome).toMatchObject({ ok: true, source: 'intents', compared: true, get: { amount: '17.5' } })
  })

  it('still quotes what the wallet can’t cover yet, and says so', async () => {
    const { quote } = quoter({ portfolio: async () => portfolio('2') })
    expect(await quote({ fromAsset: 'NEAR', toAsset: 'USDC', toChain: 'base', amount: '5' })).toMatchObject({ ok: true, enough: false, held: { amount: '2' } })
    const unread = quoter({ portfolio: async () => ({ ok: false, reason: 'unavailable' }) })
    expect(await unread.quote({ fromAsset: 'NEAR', toAsset: 'USDC', toChain: 'base', amount: '5' })).toMatchObject({ ok: true, enough: null })
  })

  it('passes on why there is no route or quote', async () => {
    expect(await quoter().quote({ fromAsset: 'XRP', fromChain: 'xrp', toAsset: 'NEAR', amount: '5' })).toEqual({ ok: false, reason: 'cannot-sign', chain: 'xrp' })
    const small = quoter({}, () => ({ ok: false, reason: 'too-small' }))
    expect(await small.quote({ fromAsset: 'NEAR', toAsset: 'USDC', toChain: 'base', amount: '0.01' })).toEqual({ ok: false, reason: 'too-small', chain: 'base' })
  })

  it('needs Ink unlocked, and 1Click’s list', async () => {
    expect(await quoter({ accounts: async () => ({ ok: false, reason: 'locked' }) }).quote({ fromAsset: 'NEAR', toAsset: 'NEAR', amount: '1' })).toEqual({ ok: false, reason: 'locked' })
    expect(await quoter({ tokens: async () => null }).quote({ fromAsset: 'NEAR', toAsset: 'NEAR', amount: '1' })).toEqual({ ok: false, reason: 'tokens-unavailable' })
  })
})

describe('what the wallet holds, by asset', () => {
  it('counts NEAR available as wrapped NEAR, tokens on NEAR as the wallet’s and Intents tokens by their id', () => {
    const held = holdingsOf(portfolio('2.5', [intentsUsdc('3'), { ...intentsUsdc('7'), id: 'near:usdc', group: 'near', network: 'near', contract: 'usdc.near' }]))
    expect(Object.fromEntries(held)).toEqual({ 'wallet:nep141:wrap.near': 25n * 10n ** 23n, [`intents:${BASE_USDC.assetId}`]: 3_000_000n, 'wallet:nep141:usdc.near': 7_000_000n })
    expect(holdingsOf({ ok: false, reason: 'locked' }).size).toBe(0)
  })
})
