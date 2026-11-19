import { describe, expect, it } from 'vitest'
import { depositAddress, depositChains } from './deposits'

const ACCOUNT = 'a'.repeat(64)
const NOW = Date.parse('2026-11-19T06:45:25.000Z')
const USDC_BASE = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near'
const XLM = 'nep245:v2_1.omni.hot.tg:1100_111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz'

/** 1Click as a fake server: its token list, and a quote answer worked out from what was asked. */
function oneClick({ tokens, quote }: { tokens?: unknown; quote?: (sent: Record<string, unknown>) => { status: number; body: unknown } }) {
  const asked: Record<string, unknown>[] = []
  const fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith('/v0/tokens')) return tokens === undefined ? new Response('down', { status: 503 }) : new Response(JSON.stringify(tokens))
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>
    asked.push(sent)
    if (!quote) return new Response('down', { status: 503 })
    const { status, body } = quote(sent)
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof globalThis.fetch
  return { fetch, asked }
}

/** 1Click's answer to a deposit quote, echoing what was asked. */
const quoted = (sent: Record<string, unknown>, quote: Record<string, unknown> = {}) => ({
  status: 201,
  body: {
    quote: { amountIn: '0', minAmountIn: '150000', depositAddress: '0xD4D627Fef4129b2A0acE03944a5E88856a289185', timeWhenInactive: '2026-11-24T06:45:25.000Z', deadline: '2026-11-24T06:45:25.000Z', ...quote },
    quoteRequest: { ...sent, depositMode: sent.depositMode ?? 'SIMPLE' },
  },
})

const token = (blockchain: string, symbol: string, assetId: string, decimals = 6) => ({ assetId, symbol, decimals, blockchain, price: 1 })

describe('the chains NEAR Intents takes deposits on', () => {
  it('lists each known chain by name from 1Click’s tokens, each token with its ids and no minimum yet', async () => {
    const { fetch } = oneClick({
      tokens: [
        token('base', 'USDC', USDC_BASE),
        token('base', 'ETH', 'nep141:base.omft.near', 18),
        token('btc', 'BTC', 'nep141:btc.omft.near', 8),
        token('btc', 'BTC', 'nep245:v2_1.omni.hot.tg:btc', 8),
        token('qtc', 'QTC', 'nep141:qtc.omft.near', 8),
      ],
    })
    expect(await depositChains({ fetch })).toEqual([
      {
        key: 'eth:8453',
        name: 'Base',
        mark: 'base',
        tokens: [
          { symbol: 'ETH', min: null, ids: ['nep141:base.omft.near'], decimals: 18 },
          { symbol: 'USDC', min: null, ids: [USDC_BASE], decimals: 6 },
        ],
      },
      // Listed twice: the first listing is the one used, and both ids are kept.
      { key: 'btc:mainnet', name: 'Bitcoin', mark: 'bitcoin', tokens: [{ symbol: 'BTC', min: null, ids: ['nep141:btc.omft.near', 'nep245:v2_1.omni.hot.tg:btc'], decimals: 8 }] },
    ])
  })

  it('leaves out symbols that aren’t one word, and is null when 1Click can’t be read', async () => {
    expect(await depositChains(oneClick({ tokens: [token('base', 'Claim at example.test', 'nep141:x.near')] }))).toEqual([])
    expect(await depositChains(oneClick({}))).toBeNull()
  })
})

describe('a deposit address for one token', () => {
  it('asks 1Click for any amount of the token into the account’s Intents balance, and gives the address, its minimum and when it closes', async () => {
    const { fetch, asked } = oneClick({ quote: (sent) => quoted(sent) })
    expect(await depositAddress(ACCOUNT, { id: USDC_BASE, decimals: 6 }, { fetch, now: () => NOW })).toEqual({
      address: '0xD4D627Fef4129b2A0acE03944a5E88856a289185',
      memo: null,
      min: '0.15',
      until: Date.parse('2026-11-24T06:45:25.000Z'),
    })
    expect(asked).toEqual([
      {
        dry: false,
        swapType: 'FLEX_INPUT',
        slippageTolerance: 100,
        originAsset: USDC_BASE,
        depositType: 'ORIGIN_CHAIN',
        destinationAsset: USDC_BASE,
        amount: '0',
        refundTo: ACCOUNT,
        refundType: 'INTENTS',
        recipient: ACCOUNT,
        recipientType: 'INTENTS',
        deadline: '2026-11-22T06:45:25.000Z',
      },
    ])
  })

  it('gives no minimum when 1Click takes any amount', async () => {
    const { fetch } = oneClick({ quote: (sent) => quoted(sent, { minAmountIn: '0' }) })
    expect(await depositAddress(ACCOUNT, { id: USDC_BASE, decimals: 6 }, { fetch, now: () => NOW })).toMatchObject({ min: null })
  })

  it('asks again in memo form for a chain that needs one, and gives the memo', async () => {
    const { fetch, asked } = oneClick({
      quote: (sent) =>
        sent.depositMode === 'MEMO'
          ? quoted(sent, { depositAddress: 'GDJ4JZXZELZD737NVFORH4PSSQDWFDZTKW3AIDKHYQG23ZXBPDGGQBJK', depositMemo: '244814683', minAmountIn: '0' })
          : { status: 400, body: { message: 'Incorrect depositMode for originAsset from stellar chain' } },
    })
    expect(await depositAddress(ACCOUNT, { id: XLM, decimals: 7 }, { fetch, now: () => NOW })).toMatchObject({ address: 'GDJ4JZXZELZD737NVFORH4PSSQDWFDZTKW3AIDKHYQG23ZXBPDGGQBJK', memo: '244814683', min: null })
    expect(asked.map((sent) => sent.depositMode ?? null)).toEqual([null, 'MEMO'])
  })

  it('refuses an answer for another account or token, an address that isn’t one, one already closed, and 1Click down', async () => {
    const at = (quote: (sent: Record<string, unknown>) => { status: number; body: unknown }) => depositAddress(ACCOUNT, { id: USDC_BASE, decimals: 6 }, { ...oneClick({ quote }), now: () => NOW })
    expect(await at((sent) => quoted({ ...sent, recipient: 'b'.repeat(64) }))).toBeNull()
    expect(await at((sent) => quoted({ ...sent, recipientType: 'DESTINATION_CHAIN' }))).toBeNull()
    expect(await at((sent) => quoted({ ...sent, destinationAsset: 'nep141:wrap.near' }))).toBeNull()
    expect(await at((sent) => quoted(sent, { depositAddress: 'send it to me' }))).toBeNull()
    expect(await at((sent) => quoted(sent, { timeWhenInactive: '2026-11-18T00:00:00.000Z' }))).toBeNull()
    expect(await at(() => ({ status: 400, body: { message: 'tokenIn is not valid' } }))).toBeNull()
    expect(await depositAddress(ACCOUNT, { id: USDC_BASE, decimals: 6 }, oneClick({}))).toBeNull()
  })
})
