import { describe, expect, it } from 'vitest'
import type { OneClickToken } from './one-click'
import { accountChainFor, chainCode, pickRoute, tokenOn, type Route } from './route'

const token = (assetId: string, symbol: string, blockchain: string, decimals = 6, contract: string | null = null): OneClickToken => ({ assetId, symbol, decimals, blockchain, contract, usd: 1 })

const WNEAR = token('nep141:wrap.near', 'wNEAR', 'near', 24, 'wrap.near')
const NEAR_USDC = token('nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', 'USDC', 'near', 6, '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1')
const BASE_USDC = token('nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', 'USDC', 'base', 6, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
const ETH_USDC = token('nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near', 'USDC', 'eth', 6, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
const BSC_USDC = token('nep245:v2_1.omni.hot.tg:56_usdc', 'USDC', 'bsc', 18)
const SOL = token('nep141:sol.omft.near', 'SOL', 'sol', 9)
const BTC = token('nep141:btc.omft.near', 'BTC', 'btc', 8)
const XRP = token('nep245:v2_1.omni.hot.tg:1100_xrp', 'XRP', 'xrp', 6)
const TOKENS = [WNEAR, NEAR_USDC, BASE_USDC, ETH_USDC, BSC_USDC, SOL, BTC, XRP]

const NEAR = (amount: string) => BigInt(amount) * 10n ** 24n
const held = (entries: Record<string, bigint> = {}) => new Map(Object.entries(entries))
const legs = (route: Route) => (route.kind === 'intents' ? route.legs.map((leg) => `${leg.source}:${leg.from.blockchain}:${leg.from.symbol}`) : [])

describe('chains and tokens by name', () => {
  it('reads a chain as people write it, and only chains 1Click lists', () => {
    expect(chainCode('Base', TOKENS)).toBe('base')
    expect(chainCode('ethereum', TOKENS)).toBe('eth')
    expect(chainCode(' Solana ', TOKENS)).toBe('sol')
    expect(chainCode('bitcoin', TOKENS)).toBe('btc')
    expect(chainCode('BNB Chain', TOKENS)).toBe('bsc')
    expect(chainCode('intents', TOKENS)).toBe('intents')
    expect(chainCode('arbitrum', TOKENS)).toBeNull()
    expect(chainCode('moon', TOKENS)).toBeNull()
  })

  it('finds a token by symbol, contract or id, with native NEAR as wrapped NEAR', () => {
    expect(tokenOn('near', 'near', TOKENS)).toBe(WNEAR)
    expect(tokenOn('usdc', 'base', TOKENS)).toBe(BASE_USDC)
    expect(tokenOn('0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913', 'base', TOKENS)).toBe(BASE_USDC)
    expect(tokenOn('nep141:sol.omft.near', 'sol', TOKENS)).toBe(SOL)
    expect(tokenOn('USDC', 'sol', TOKENS)).toBeNull()
    expect(tokenOn('USDC', 'base', [...TOKENS, token('nep141:fake.near', 'USDC', 'base')])).toBe('ambiguous')
  })

  it('knows which of the wallet’s accounts receives on each chain', () => {
    expect(['near', 'base', 'eth', 'bsc', 'sol', 'btc', 'tron', 'sui', 'aptos', 'xrp', 'doge'].map(accountChainFor)).toEqual(['near', 'evm', 'evm', 'evm', 'solana', 'bitcoin', 'tron', 'sui', 'aptos', null, null])
  })
})

describe('picking a route', () => {
  it('sends native NEAR on NEAR directly', () => {
    const route = pickRoute({ fromAsset: 'NEAR', toAsset: 'NEAR', amount: '1' }, TOKENS, held({ 'wallet:nep141:wrap.near': NEAR('10') }))
    expect(route).toEqual({ kind: 'direct', chain: 'near', asset: WNEAR, amount: NEAR('1'), held: NEAR('10') })
  })

  it('goes through Intents from the wallet for another chain or token', () => {
    const route = pickRoute({ fromAsset: 'NEAR', toAsset: 'USDC', toChain: 'base', amount: '5' }, TOKENS, held({ 'wallet:nep141:wrap.near': NEAR('10') }))
    expect(route).toMatchObject({ kind: 'intents', to: BASE_USDC, toIntents: false })
    expect(legs(route)).toEqual(['wallet:near:wNEAR'])
    expect(route.kind === 'intents' && route.legs[0]?.amount).toBe(NEAR('5'))
  })

  it('stays on the chain the funds are on when no chain is named', () => {
    const route = pickRoute({ fromAsset: 'NEAR', toAsset: 'USDC', amount: '5' }, TOKENS, held())
    expect(route).toMatchObject({ kind: 'intents', to: NEAR_USDC })
  })

  it('finds a token’s own chain when it lives on only one', () => {
    expect(pickRoute({ fromAsset: 'NEAR', toAsset: 'BTC', amount: '5' }, TOKENS, held())).toMatchObject({ kind: 'intents', to: BTC })
    expect(pickRoute({ fromAsset: 'NEAR', toAsset: 'SOL', amount: '5' }, TOKENS, held())).toMatchObject({ kind: 'intents', to: SOL })
  })

  it('takes the chain whose own coin it is when a symbol is also bridged elsewhere', () => {
    const bridged = [...TOKENS, token('nep141:sol-on-aptos', 'SOL', 'aptos', 8, '0xsol'), token('nep141:xrp-on-starknet', 'XRP', 'starknet', 6, '0xxrp')]
    expect(pickRoute({ fromAsset: 'NEAR', toAsset: 'SOL', amount: '5' }, bridged, held())).toMatchObject({ kind: 'intents', to: SOL })
    expect(pickRoute({ fromAsset: 'NEAR', toAsset: 'XRP', amount: '5' }, bridged, held())).toMatchObject({ kind: 'intents', to: XRP })
    const twoBridged = [...TOKENS, token('nep141:wif-a', 'WIF', 'sol', 6, 'a'), token('nep141:wif-b', 'WIF', 'base', 6, 'b')]
    expect(pickRoute({ fromAsset: 'NEAR', toAsset: 'WIF', amount: '5' }, twoBridged, held())).toEqual({ kind: 'none', reason: 'unknown-asset', name: 'WIF', chain: null })
  })

  it('keeps both the wallet and the Intents balance when both hold the token, the one that covers it first', () => {
    const both = held({ 'wallet:nep141:wrap.near': NEAR('2'), 'intents:nep141:wrap.near': NEAR('50') })
    expect(legs(pickRoute({ fromAsset: 'NEAR', toAsset: 'SOL', amount: '5' }, TOKENS, both))).toEqual(['intents:near:wNEAR', 'wallet:near:wNEAR'])
    const richWallet = held({ 'wallet:nep141:wrap.near': NEAR('50'), 'intents:nep141:wrap.near': NEAR('50') })
    expect(legs(pickRoute({ fromAsset: 'NEAR', toAsset: 'SOL', amount: '5' }, TOKENS, richWallet))).toEqual(['wallet:near:wNEAR', 'intents:near:wNEAR'])
  })

  it('pays from the Intents balance, whichever chain the token came from', () => {
    const balance = held({ [`intents:${BASE_USDC.assetId}`]: 3_000_000n, [`intents:${ETH_USDC.assetId}`]: 20_000_000n })
    const route = pickRoute({ fromAsset: 'USDC', fromChain: 'intents', toAsset: 'SOL', amount: '10' }, TOKENS, balance)
    expect(legs(route)).toEqual(['intents:eth:USDC', 'intents:base:USDC'])
    expect(route).toMatchObject({ kind: 'intents', to: SOL })
  })

  it('reads the amount at each token’s own decimals', () => {
    const balance = held({ [`intents:${BSC_USDC.assetId}`]: 20n * 10n ** 18n, [`intents:${BASE_USDC.assetId}`]: 1n })
    const route = pickRoute({ fromAsset: 'USDC', fromChain: 'intents', toAsset: 'SOL', amount: '10' }, TOKENS, balance)
    expect(route.kind === 'intents' && route.legs.map((leg) => leg.amount)).toEqual([10n * 10n ** 18n, 10_000_000n])
  })

  it('finds a token held only in the Intents balance when no chain is named', () => {
    const route = pickRoute({ fromAsset: 'SOL', toAsset: 'NEAR', amount: '1' }, TOKENS, held({ [`intents:${SOL.assetId}`]: 5n * 10n ** 9n }))
    expect(legs(route)).toEqual(['intents:sol:SOL'])
    expect(route).toMatchObject({ kind: 'intents', to: WNEAR })
  })

  it('withdraws the same token from the Intents balance to its own chain', () => {
    const route = pickRoute({ fromAsset: 'USDC', fromChain: 'base', toAsset: 'USDC', toChain: 'base', amount: '1' }, TOKENS, held({ [`intents:${BASE_USDC.assetId}`]: 5_000_000n }))
    expect(legs(route)).toEqual(['intents:base:USDC'])
  })

  it('pays into the Intents balance', () => {
    expect(pickRoute({ fromAsset: 'NEAR', toAsset: 'USDC', toChain: 'intents', amount: '5' }, TOKENS, held())).toMatchObject({ kind: 'intents', to: NEAR_USDC, toIntents: true })
  })

  it('says when the funds are only on a chain Ink can’t sign for yet', () => {
    expect(pickRoute({ fromAsset: 'USDC', fromChain: 'base', toAsset: 'NEAR', amount: '5' }, TOKENS, held())).toEqual({ kind: 'none', reason: 'cannot-sign', chain: 'base' })
    expect(pickRoute({ fromAsset: 'SOL', toAsset: 'NEAR', amount: '1' }, TOKENS, held())).toEqual({ kind: 'none', reason: 'cannot-sign', chain: 'sol' })
  })

  it('says a token send on NEAR isn’t built yet, unless the Intents balance can pay it', () => {
    expect(pickRoute({ fromAsset: 'USDC', toAsset: 'USDC', amount: '5' }, TOKENS, held())).toEqual({ kind: 'none', reason: 'direct-not-built', chain: 'near' })
  })

  it('refuses names it doesn’t know or can’t tell apart, and amounts that aren’t one', () => {
    expect(pickRoute({ fromAsset: 'NEAR', toAsset: 'USDC', toChain: 'moon', amount: '5' }, TOKENS, held())).toEqual({ kind: 'none', reason: 'unknown-chain', name: 'moon' })
    expect(pickRoute({ fromAsset: 'NEAR', toAsset: 'DOGE', toChain: 'base', amount: '5' }, TOKENS, held())).toEqual({ kind: 'none', reason: 'unknown-asset', name: 'DOGE', chain: 'base' })
    expect(pickRoute({ fromAsset: 'NOPE', toAsset: 'NEAR', amount: '5' }, TOKENS, held())).toEqual({ kind: 'none', reason: 'unknown-asset', name: 'NOPE', chain: null })
    expect(pickRoute({ fromAsset: 'NEAR', toAsset: 'USDC', toChain: 'base', amount: '5' }, [...TOKENS, token('nep141:fake.near', 'USDC', 'base')], held())).toEqual({
      kind: 'none',
      reason: 'ambiguous-asset',
      name: 'USDC',
      chain: 'base',
    })
    for (const amount of ['0', '-1', '1e3', 'all', '0.0000000000000000000000001'])
      expect(pickRoute({ fromAsset: 'NEAR', toAsset: 'SOL', amount }, TOKENS, held())).toEqual({ kind: 'none', reason: 'bad-amount' })
  })
})
