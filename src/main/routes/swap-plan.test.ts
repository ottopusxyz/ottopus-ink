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
    held: async () => new Map(),
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

  it('pays an address the person typed, when it’s a valid address on that chain', async () => {
    const friend = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    const { options, asked } = deps()
    const built = await buildOneClickSwap({ ...SWAP, to: friend }, OWN, options)
    expect(asked[0]).toMatchObject({ recipient: friend, recipientType: 'DESTINATION_CHAIN', refundTo: NEAR_ID })
    expect(built).toMatchObject({ ok: true, swap: { recipient: friend, refundTo: NEAR_ID }, payout: { address: friend, chain: 'evm' } })
  })

  it('refuses a typed address that isn’t one on that chain, or on a chain it can’t check yet, without asking 1Click', async () => {
    const { options, asked } = deps()
    expect(await buildOneClickSwap({ ...SWAP, to: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD' }, OWN, options)).toEqual({ ok: false, reason: 'bad-address' })
    expect(await buildOneClickSwap({ ...SWAP, to: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' }, OWN, options)).toEqual({ ok: false, reason: 'bad-address' })
    expect(await buildOneClickSwap({ ...SWAP, toAsset: 'XRP', toChain: 'xrp', to: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe' }, OWN, options)).toEqual({ ok: false, reason: 'bad-address' })
    expect(asked).toEqual([])
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

describe('building a swap paid from the Intents balance', () => {
  const USDC_BASE = 'nep141:base-usdc.omft.near'
  const holding = (raw: bigint) => async () => new Map([[`intents:${USDC_BASE}`, raw]])
  const FROM_INTENTS: PlanIntent = { outcome: 'swap', asset: 'USDC', amount: '25', chain: 'intents', to: null, toAsset: 'NEAR', toChain: 'near' }

  it('moves the token inside intents.near to the deposit address, in one call, with a refund back into the balance', async () => {
    const { options, asked, fitted } = deps({ held: holding(30_000_000n) })
    const built = await buildOneClickSwap(FROM_INTENTS, OWN, options)
    if (!built.ok) throw new Error(built.reason)
    expect(asked[0]).toMatchObject({ originAsset: USDC_BASE, destinationAsset: 'nep141:wrap.near', amount: 25_000_000n, depositType: 'INTENTS', refundTo: NEAR_ID, recipient: NEAR_ID })
    const step = callsOfStep(built.steps[0]!)
    expect(step).toMatchObject({ signerId: NEAR_ID, receiverId: 'intents.near', calls: [{ method: 'mt_transfer', receiverId: DEPOSIT, tokenId: USDC_BASE, amount: 25_000_000n }] })
    expect(built.swap).toMatchObject({ payFrom: 'intents', sendSymbol: 'USDC', sendDecimals: '6', amountIn: '25000000', refundTo: NEAR_ID })
    // Only the yoctoNEAR the transfer attaches, and its fee, come from the NEAR account.
    expect(fitted).toEqual([[NEAR_ID, 1n, 50n * 10n ** 12n, 1]])
  })

  it('withdraws a token to its own chain, paid to the wallet’s own address there', async () => {
    const { options, asked } = deps({ held: holding(30_000_000n) })
    const built = await buildOneClickSwap({ ...FROM_INTENTS, toAsset: 'USDC', toChain: 'base' }, OWN, options)
    if (!built.ok) throw new Error(built.reason)
    expect(asked[0]).toMatchObject({ originAsset: USDC_BASE, destinationAsset: USDC_BASE, depositType: 'INTENTS', recipient: EVM, recipientType: 'DESTINATION_CHAIN' })
    expect(built.payout).toEqual({ address: EVM, chain: 'evm' })
  })

  it('refuses more than the balance holds, and says so when the balance can’t be read', async () => {
    expect(await buildOneClickSwap(FROM_INTENTS, OWN, deps({ held: holding(10_000_000n) }).options)).toEqual({ ok: false, reason: 'insufficient-funds' })
    expect(await buildOneClickSwap(FROM_INTENTS, OWN, deps({ held: async () => null }).options)).toEqual({ ok: false, reason: 'chain-unavailable' })
  })

  it('still pays NEAR from the wallet when the wallet is the source', async () => {
    const { options, asked } = deps({ held: holding(30_000_000n) })
    const built = await buildOneClickSwap(SWAP, OWN, options)
    if (!built.ok) throw new Error(built.reason)
    expect(asked[0]?.depositType).toBe('ORIGIN_CHAIN')
    expect(built.swap?.payFrom).toBeUndefined()
  })
})

describe('building a swap the wallet pays on an EVM chain', () => {
  const USDC_CONTRACT = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
  const EVM_DEPOSIT = '0x8f436D184823B77188DE973322278686c3780C2c'
  const SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
  const withSolana: Account[] = [...OWN, { chain: 'solana', path: "m/44'/501'/0'/0'", address: SOL }]
  const LISTED = [...TOKENS.filter((each) => each.assetId !== 'nep141:base-usdc.omft.near'), { ...token('nep141:base-usdc.omft.near', 'USDC', 'base'), contract: USDC_CONTRACT }, token('nep141:sol-usdc.omft.near', 'USDC', 'sol')]
  const evmRpc = (tokens = 50_000_000n) =>
    (({
      balance: async () => 10n ** 16n,
      tokenBalance: async () => tokens,
      decimals: async () => 6,
      symbol: async () => 'USDC',
      estimateGas: async () => 50_000n,
      fees: async () => ({ baseFee: 10_000_000n, tip: 1_000_000n }),
      nonce: async () => 0n,
      l1FeeUpperBound: async () => 0n,
      send: async () => '',
      receipt: async () => null,
    }) as unknown as import('../evm/rpc').EvmRpc)
  const FROM_BASE: PlanIntent = { outcome: 'swap', asset: 'USDC', amount: '10', chain: 'base', to: null, toAsset: 'USDC', toChain: 'solana' }

  it('sends the token from the wallet’s EVM address to the deposit address there, with a refund back to it', async () => {
    const { options, asked } = deps({ tokens: async () => LISTED, evmRpc: () => evmRpc() }, (request) => ({
      ok: true,
      quote: { amountIn: request.amount, amountOut: 9_970_000n, minAmountOut: 9_870_000n, amountInUsd: 10, amountOutUsd: 9.97, seconds: 30, withdrawFee: 0n, feeBps: 20, depositAddress: EVM_DEPOSIT, depositMemo: null, deadline: new Date(request.deadline) },
    }))
    const built = await buildOneClickSwap(FROM_BASE, withSolana, options)
    if (!built.ok) throw new Error(built.reason)
    expect(asked[0]).toMatchObject({ originAsset: 'nep141:base-usdc.omft.near', destinationAsset: 'nep141:sol-usdc.omft.near', amount: 10_000_000n, depositType: 'ORIGIN_CHAIN', refundTo: EVM, recipient: SOL })
    expect(built.steps[0]).toMatchObject({ chain: 'evm', action: 'transfer', fields: { chainId: '8453', from: EVM, to: EVM_DEPOSIT, token: USDC_CONTRACT, amount: '10000000' } })
    expect(built.swap).toMatchObject({ payFrom: 'evm', sendSymbol: 'USDC', sendDecimals: '6', sendChainId: '8453', sendToken: USDC_CONTRACT, refundTo: EVM })
  })

  it('refuses more than the address holds, and a deposit address that isn’t one on that chain', async () => {
    const toEvmDeposit = (request: OneClickQuoteRequest): OneClickQuoteResult => ({
      ok: true,
      quote: { amountIn: request.amount, amountOut: 1n, minAmountOut: 1n, amountInUsd: 10, amountOutUsd: 9.97, seconds: 30, withdrawFee: 0n, feeBps: 20, depositAddress: EVM_DEPOSIT, depositMemo: null, deadline: new Date(request.deadline) },
    })
    expect(await buildOneClickSwap(FROM_BASE, withSolana, deps({ tokens: async () => LISTED, evmRpc: () => evmRpc(1n) }, toEvmDeposit).options)).toEqual({ ok: false, reason: 'insufficient-funds' })
    // The default quote's deposit address is a NEAR account, which can't take a deposit sent on Base.
    expect(await buildOneClickSwap(FROM_BASE, withSolana, deps({ tokens: async () => LISTED, evmRpc: () => evmRpc() }).options)).toEqual({ ok: false, reason: 'chain-unavailable' })
  })
})
