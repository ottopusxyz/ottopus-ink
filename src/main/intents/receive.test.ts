import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import type { IntentsDepositChain } from '../../shared/ipc'
import { pickReceive, receiveChains, searchTokens } from './receive'

const NEAR = 'a'.repeat(64)
const EVM = '0x1111111111111111111111111111111111111111'
const ACCOUNTS: Account[] = [
  { chain: 'near', path: "m/44'/397'/0'", address: NEAR },
  { chain: 'evm', path: "m/44'/60'/0'/0/0", address: EVM },
  { chain: 'bitcoin', path: "m/84'/0'/0'/0/0", address: 'bc1qown' },
]
const LISTED: (Omit<IntentsDepositChain, 'tokens'> & { tokens: { symbol: string; min: string }[] })[] = [
  { key: 'eth:8453', name: 'Base', mark: 'base', tokens: [{ symbol: 'USDC', min: '1' }, { symbol: 'ETH', min: '0.0000001' }, { symbol: 'BRETT', min: '1' }, { symbol: 'WETH', min: '0.0001' }, { symbol: 'cbBTC', min: '0.00001' }] },
  { key: 'btc:mainnet', name: 'Bitcoin', mark: 'bitcoin', tokens: [{ symbol: 'BTC', min: '0.00007' }] },
  { key: 'xrp:mainnet', name: 'XRP Ledger', mark: 'xrp', tokens: [{ symbol: 'XRP', min: '2' }] },
  { key: 'stellar:mainnet', name: 'Stellar', mark: null, tokens: [{ symbol: 'XLM', min: '0.1' }] },
]
/** Each token with the bridge's id for it, as the bridge lists them. */
const BRIDGE: IntentsDepositChain[] = LISTED.map((chain) => ({ ...chain, tokens: chain.tokens.map((token) => ({ ...token, ids: [`${chain.key}:${token.symbol.toLowerCase()}`] })) }))
const DEPOSITS: Record<string, { address: string; memo: string | null }> = {
  'eth:8453': { address: '0xbridgebase', memo: null },
  'btc:mainnet': { address: 'bc1qbridge', memo: null },
  'xrp:mainnet': { address: 'rBridge', memo: null },
  'stellar:mainnet': { address: 'GBRIDGE', memo: '177237517' },
}
const deps = (overrides: Partial<Parameters<typeof pickReceive>[1]> = {}) => {
  const asked: string[] = []
  return {
    asked,
    deps: {
      bridge: BRIDGE,
      accounts: ACCOUNTS,
      depositAddress: async (account: string, key: string) => (asked.push(`${account} ${key}`), DEPOSITS[key] ?? null),
      ...overrides,
    },
  }
}

describe('the chains to receive on', () => {
  it('joins the wallet’s own chains with NEAR Intents’, five common ones first, each with its top tokens', () => {
    const chains = receiveChains(BRIDGE)
    expect(chains.slice(0, 5).map((chain) => chain.id)).toEqual(['near', 'base', 'ethereum', 'solana', 'bitcoin'])
    expect(chains.find((chain) => chain.id === 'base')).toMatchObject({ own: 'evm', intents: true, tokens: [{ symbol: 'ETH', min: '0.0000001' }, { symbol: 'USDC', min: '1' }, { symbol: 'BRETT' }, { symbol: 'cbBTC' }] })
    // Only the wallet's own chain: its own coin, no minimum.
    expect(chains.find((chain) => chain.id === 'ethereum')).toMatchObject({ own: 'evm', intents: false, tokens: [{ symbol: 'ETH', min: null, intents: false }] })
    // Only NEAR Intents': no account of the wallet's own there.
    expect(chains.find((chain) => chain.id === 'xrp')).toMatchObject({ own: null, intents: true })
    // Neither: not offered.
    expect(chains.find((chain) => chain.id === 'dogecoin')).toBeUndefined()
  })

  it('still offers the wallet’s own chains when the bridge can’t be read', () => {
    expect(receiveChains(null).every((chain) => chain.own !== null && !chain.intents)).toBe(true)
  })
})

describe('searching a chain’s tokens', () => {
  it('finds NEAR Intents’ tokens first, with their minimums, then Zerion’s, once each', () => {
    const found = searchTokens('base', 'b', BRIDGE, [
      { symbol: 'BRETT', name: 'Brett', icon: 'data:image/png;base64,QlJFVFQ=' },
      { symbol: 'BALD', name: 'Bald', icon: null },
    ])
    expect(found.map((token) => [token.symbol, token.intents, token.min, token.icon])).toEqual([
      // NEAR Intents takes it, and Zerion's icon comes along.
      ['BRETT', true, '1', 'data:image/png;base64,QlJFVFQ='],
      ['cbBTC', true, '0.00001', null],
      ['BALD', false, null, null],
    ])
    expect(searchTokens('base', 'usdc', BRIDGE, [])[0]).toMatchObject({ symbol: 'USDC', intents: true })
    expect(searchTokens('moon', 'usdc', BRIDGE, [])).toEqual([])
  })
})

describe('where to receive, NEAR Intents first', () => {
  it('gives NEAR Intents’ deposit address when it takes the token, credited to the wallet’s NEAR account', async () => {
    const { deps: options, asked } = deps()
    expect(await pickReceive({ chain: 'base', asset: 'usdc', amount: null }, options)).toEqual({ ok: true, kind: 'intents', chain: 'base', chainName: 'Base', asset: 'USDC', address: '0xbridgebase', memo: null, min: '1', account: NEAR })
    expect(asked).toEqual([`${NEAR} eth:8453`])
    expect(await pickReceive({ chain: 'base', asset: 'USDC', amount: '25' }, options)).toMatchObject({ kind: 'intents' })
    expect(await pickReceive({ chain: 'stellar', asset: 'XLM', amount: null }, options)).toMatchObject({ kind: 'intents', memo: '177237517' })
  })

  it('gives the wallet’s own address when the amount is under NEAR Intents’ minimum', async () => {
    expect(await pickReceive({ chain: 'base', asset: 'USDC', amount: '0.5' }, deps().deps)).toEqual({ ok: true, kind: 'own', chain: 'base', chainName: 'Base', asset: 'USDC', address: EVM, path: "m/44'/60'/0'/0/0", why: 'below-minimum', min: '1' })
    expect(await pickReceive({ chain: 'bitcoin', asset: 'BTC', amount: '0.00001' }, deps().deps)).toMatchObject({ kind: 'own', address: 'bc1qown', why: 'below-minimum' })
  })

  it('gives the wallet’s own address for a token NEAR Intents doesn’t take there, or when the bridge won’t answer', async () => {
    expect(await pickReceive({ chain: 'base', asset: 'DEGEN', amount: null }, deps().deps)).toMatchObject({ kind: 'own', address: EVM, why: 'not-in-intents', min: null })
    expect(await pickReceive({ chain: 'ethereum', asset: 'ETH', amount: null }, deps().deps)).toMatchObject({ kind: 'own', address: EVM, why: 'not-in-intents' })
    expect(await pickReceive({ chain: 'base', asset: 'USDC', amount: null }, deps({ depositAddress: async () => null }).deps)).toMatchObject({ kind: 'own', why: 'intents-unavailable' })
  })

  it('says plainly when neither can take it, and refuses what isn’t a chain or an amount', async () => {
    expect(await pickReceive({ chain: 'xrp', asset: 'XRP', amount: '1' }, deps().deps)).toEqual({ ok: false, reason: 'below-minimum', min: '2' })
    expect(await pickReceive({ chain: 'xrp', asset: 'USDC', amount: null }, deps().deps)).toEqual({ ok: false, reason: 'not-supported', min: null })
    expect(await pickReceive({ chain: 'moon', asset: 'USDC', amount: null }, deps().deps)).toEqual({ ok: false, reason: 'unknown-chain' })
    expect(await pickReceive({ chain: 'base', asset: 'USDC', amount: 'lots' }, deps().deps)).toEqual({ ok: false, reason: 'bad-amount' })
  })

  it('knows chains by the names people and agents use', async () => {
    expect(await pickReceive({ chain: 'BTC', asset: 'BTC', amount: null }, deps().deps)).toMatchObject({ kind: 'intents', chain: 'bitcoin' })
    expect(await pickReceive({ chain: 'Bnb chain', asset: 'BNB', amount: null }, deps().deps)).toMatchObject({ kind: 'own', chain: 'bsc' })
  })
})
