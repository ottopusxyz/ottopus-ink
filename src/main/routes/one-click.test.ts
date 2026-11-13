import { describe, expect, it } from 'vitest'
import { oneClickQuote, oneClickTokens, type OneClickQuoteRequest } from './one-click'

const respond = (body: unknown, status = 200) => {
  const calls: { url: string; body: Record<string, unknown> | null }[] = []
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near'

describe('1Click’s token list', () => {
  it('keeps each token plainly listed, with its chain, contract and price', async () => {
    const { fetch } = respond([
      { assetId: 'nep141:wrap.near', decimals: 24, blockchain: 'near', symbol: 'wNEAR', price: 3.5, contractAddress: 'wrap.near' },
      { assetId: BASE_USDC, decimals: 6, blockchain: 'base', symbol: 'USDC', price: 0.9995, contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
      { assetId: 'nep141:btc.omft.near', decimals: 8, blockchain: 'btc', symbol: 'BTC', price: 69000 },
    ])
    expect(await oneClickTokens({ fetch })).toEqual([
      { assetId: 'nep141:wrap.near', symbol: 'wNEAR', decimals: 24, blockchain: 'near', contract: 'wrap.near', usd: 3.5 },
      { assetId: BASE_USDC, symbol: 'USDC', decimals: 6, blockchain: 'base', contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', usd: 0.9995 },
      { assetId: 'nep141:btc.omft.near', symbol: 'BTC', decimals: 8, blockchain: 'btc', contract: null, usd: 69000 },
    ])
  })

  it('leaves out retired and second listings, odd ids and symbols that aren’t one word', async () => {
    const { fetch } = respond([
      { assetId: 'nep141:old.near', decimals: 6, blockchain: 'pol', symbol: 'USDC(DEPRECATED)', price: 1 },
      { assetId: '1cs_v1:btc:native:coin', decimals: 8, blockchain: 'btc', symbol: 'BTC(OMNI)', price: 69000 },
      { assetId: 'not an id', decimals: 6, blockchain: 'base', symbol: 'X', price: 1 },
      { assetId: 'nep141:spam.near', decimals: 6, blockchain: 'near', symbol: 'Claim at example.test', price: 1 },
      { assetId: 'nep141:odd.near', decimals: 99, blockchain: 'near', symbol: 'ODD', price: 1 },
      { assetId: 'nep141:free.near', decimals: 6, blockchain: 'near', symbol: 'FREE', price: 0 },
    ])
    expect(await oneClickTokens({ fetch })).toEqual([{ assetId: 'nep141:free.near', symbol: 'FREE', decimals: 6, blockchain: 'near', contract: null, usd: null }])
  })

  it('is null when 1Click can’t be read', async () => {
    expect(await oneClickTokens(respond('down', 503))).toBeNull()
    expect(await oneClickTokens(respond({ not: 'a list' }))).toBeNull()
  })
})

describe('a 1Click quote', () => {
  const request: OneClickQuoteRequest = {
    originAsset: 'nep141:wrap.near',
    destinationAsset: BASE_USDC,
    amount: 5n * 10n ** 24n,
    depositType: 'ORIGIN_CHAIN',
    refundTo: 'alice.near',
    recipient: '0x1111111111111111111111111111111111111111',
    recipientType: 'DESTINATION_CHAIN',
    dry: true,
    deadline: new Date('2026-11-13T12:00:00Z'),
    slippageBps: 100,
  }
  const echo = (overrides: Record<string, unknown> = {}) => ({
    dry: true,
    swapType: 'EXACT_INPUT',
    originAsset: request.originAsset,
    destinationAsset: request.destinationAsset,
    amount: '5000000000000000000000000',
    refundTo: 'alice.near',
    refundType: 'ORIGIN_CHAIN',
    recipient: request.recipient,
    recipientType: 'DESTINATION_CHAIN',
    depositType: 'ORIGIN_CHAIN',
    appFees: [{ recipient: 'fees.near', fee: 20 }],
    ...overrides,
  })
  const quote = (overrides: Record<string, unknown> = {}) => ({
    amountIn: '5000000000000000000000000',
    amountInUsd: '17.40',
    amountOut: '17400531',
    amountOutUsd: '17.39',
    minAmountOut: '17226525',
    timeEstimate: 22,
    withdrawFee: '2400',
    ...overrides,
  })

  it('asks for an exact input and reads what it would pay out, with 1Click’s fee', async () => {
    const { fetch, calls } = respond({ quote: quote(), quoteRequest: echo(), signature: 'ed25519:x' })
    expect(await oneClickQuote(request, { fetch })).toEqual({
      ok: true,
      quote: { amountIn: 5n * 10n ** 24n, amountOut: 17_400_531n, minAmountOut: 17_226_525n, amountInUsd: 17.4, amountOutUsd: 17.39, seconds: 22, withdrawFee: 2400n, feeBps: 20, depositAddress: null, depositMemo: null },
    })
    expect(calls[0]?.url).toBe('https://1click.chaindefuser.com/v0/quote')
    expect(calls[0]?.body).toMatchObject({ dry: true, swapType: 'EXACT_INPUT', amount: '5000000000000000000000000', refundType: 'ORIGIN_CHAIN', slippageTolerance: 100, deadline: '2026-11-13T12:00:00.000Z' })
  })

  it('refunds inside Intents for a deposit from the Intents balance', async () => {
    const { fetch, calls } = respond({ quote: quote(), quoteRequest: echo({ depositType: 'INTENTS', refundType: 'INTENTS' }) })
    expect((await oneClickQuote({ ...request, depositType: 'INTENTS' }, { fetch })).ok).toBe(true)
    expect(calls[0]?.body).toMatchObject({ depositType: 'INTENTS', refundType: 'INTENTS' })
  })

  it('gives the deposit address only on a quote that isn’t dry', async () => {
    const { fetch } = respond({ quote: quote({ depositAddress: 'a'.repeat(64) }), quoteRequest: echo({ dry: false }) })
    const result = await oneClickQuote({ ...request, dry: false }, { fetch })
    expect(result.ok && result.quote.depositAddress).toBe('a'.repeat(64))
    const missing = respond({ quote: quote(), quoteRequest: echo({ dry: false }) })
    expect(await oneClickQuote({ ...request, dry: false }, missing)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('refuses an answer for another swap, amount, recipient or refund address', async () => {
    for (const changed of [{ recipient: '0x2222222222222222222222222222222222222222' }, { refundTo: 'mallory.near' }, { amount: '1' }, { destinationAsset: 'nep141:sol.omft.near' }, { dry: false }]) {
      expect(await oneClickQuote(request, respond({ quote: quote(), quoteRequest: echo(changed) }))).toEqual({ ok: false, reason: 'mismatch' })
    }
    expect(await oneClickQuote(request, respond({ quote: quote({ amountIn: '1' }), quoteRequest: echo() }))).toEqual({ ok: false, reason: 'mismatch' })
    expect(await oneClickQuote(request, respond({ quote: quote({ minAmountOut: '99999999' }), quoteRequest: echo() }))).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('says why 1Click turned it down, never in 1Click’s own words', async () => {
    expect(await oneClickQuote(request, respond({ message: 'Amount is too low for bridge, try at least 1000000' }, 400))).toEqual({ ok: false, reason: 'too-small' })
    expect(await oneClickQuote(request, respond({ message: 'recipient is not valid' }, 400))).toEqual({ ok: false, reason: 'bad-recipient' })
    expect(await oneClickQuote(request, respond({ message: 'Internal server error' }, 400))).toEqual({ ok: false, reason: 'no-route' })
    expect(await oneClickQuote(request, respond({ message: 'down' }, 503))).toEqual({ ok: false, reason: 'unavailable' })
    expect(await oneClickQuote(request, respond('not json'))).toEqual({ ok: false, reason: 'unavailable' })
    expect(await oneClickQuote(request, respond({ quote: quote({ amountOut: '1.5' }), quoteRequest: echo() }))).toEqual({ ok: false, reason: 'unavailable' })
  })
})
