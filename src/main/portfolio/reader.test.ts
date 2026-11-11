import { describe, expect, it } from 'vitest'
import type { NearAccountView, NearRpc } from '../near/rpc'
import { createPortfolioReader, MAX_REVIEWS, PORTFOLIO_TTL_MS, saleValue } from './reader'

const ID = 'alice.near'
const NEAR = 10n ** 24n

function fakeRpc(view: NearAccountView | null | 'down') {
  return {
    viewAccount: async () => {
      if (view === 'down') throw new Error('no RPC answered')
      return view
    },
    callView: async () => '0',
  } as unknown as NearRpc
}

interface World {
  tokens?: { contract_id: string; balance: string }[] | 'down'
  prices?: Record<string, { price: string; symbol: string; decimal: number }> | 'down'
  reviews?: Record<string, string | 'down'>
  liquidity?: Record<string, number>
}

/** The services the reader asks, by address, with a count of what was asked. */
function fakeFetch(world: World) {
  const asked: string[] = []
  const json = (body: unknown) => new Response(JSON.stringify(body))
  const fetch = (async (url: string) => {
    asked.push(url)
    if (url.endsWith('/staking')) return json({ pools: [] })
    if (url.endsWith('/ft')) return world.tokens === 'down' ? new Response('', { status: 500 }) : json({ tokens: world.tokens ?? [] })
    if (url.endsWith('/list-token-price')) return world.prices === 'down' ? new Response('', { status: 500 }) : json(world.prices ?? {})
    const token = new URL(url).searchParams.get('token_id')
    if (token) {
      const reputation = world.reviews?.[token] ?? 'Unknown'
      if (reputation === 'down') return new Response('', { status: 500 })
      return json({ account_id: token, reputation, price_usd_raw: '1.1', price_usd_raw_24h_ago: '1', liquidity_usd: world.liquidity?.[token] })
    }
    throw new Error(`unexpected ${url}`)
  }) as unknown as typeof globalThis.fetch
  return { fetch, asked }
}

const VIEW: NearAccountView = { amount: 10n * NEAR, locked: 0n, storageUsage: 182n }
const PRICES = {
  'wrap.near': { price: '4', symbol: 'wNEAR', decimal: 24 },
  'usdc.near': { price: '1', symbol: 'USDC', decimal: 6 },
  'meme.near': { price: '0.5', symbol: 'MEME', decimal: 18 },
  'scam.near': { price: '100', symbol: 'SCAM', decimal: 18 },
}

describe('what a token would fetch', () => {
  it('is the market value on a deep market, or with no liquidity figure', () => {
    expect(saleValue(1000, 10_000_000)).toBe(1000)
    expect(saleValue(1000, null)).toBe(1000)
  })

  it('falls short on a thin one, and never past the other side of the pool', () => {
    expect(saleValue(39_000, 81_000)).toBeCloseTo((39_000 * 40_500) / 79_500)
    expect(saleValue(1e12, 1000)).toBeLessThan(500)
  })
})

describe('the portfolio on NEAR', () => {
  it('values NEAR and each held token, and counts only the vouched-for ones in the total', async () => {
    const { fetch } = fakeFetch({
      tokens: [
        { contract_id: 'usdc.near', balance: '25000000' },
        { contract_id: 'meme.near', balance: '4000000000000000000' },
        { contract_id: 'scam.near', balance: '1000000000000000000' },
        { contract_id: 'nobody.near', balance: '5' },
      ],
      prices: PRICES,
      reviews: { 'wrap.near': 'Reputable', 'usdc.near': 'Reputable', 'meme.near': 'Unknown', 'scam.near': 'Spam' },
    })
    const portfolio = await createPortfolioReader({ rpc: fakeRpc(VIEW), fetch, now: () => 1000 }).near(ID)

    expect(portfolio.near).toMatchObject({ accountId: ID, onChain: true, available: '10', staked: '0', storage: '0' })
    expect(portfolio.nearPrice?.usd).toBe(4)
    expect(portfolio.nearPrice?.change24h).toBeCloseTo(0.1)
    expect(portfolio.tokens.map(({ symbol, amount, usdValue, trust }) => ({ symbol, amount, usdValue, trust }))).toEqual([
      { symbol: 'USDC', amount: '25', usdValue: 25, trust: 'reviewed' },
      { symbol: 'MEME', amount: '4', usdValue: 2, trust: 'unreviewed' },
    ])
    // The token marked spam and the one with no price are only counted.
    expect(portfolio.unpriced).toBe(2)
    expect(portfolio.totalUsd).toBe(10 * 4 + 25)
    expect(portfolio.readAt).toBe(1000)
    expect(portfolio.gaps).toEqual([])
  })

  it('still shows NEAR when the token list or the prices can’t be read, and says which', async () => {
    const noTokens = await createPortfolioReader({ rpc: fakeRpc(VIEW), fetch: fakeFetch({ tokens: 'down', prices: PRICES }).fetch }).near(ID)
    expect(noTokens).toMatchObject({ tokens: [], unpriced: 0, totalUsd: 40, gaps: ['tokens'] })

    const noPrices = await createPortfolioReader({ rpc: fakeRpc(VIEW), fetch: fakeFetch({ tokens: [{ contract_id: 'usdc.near', balance: '1' }], prices: 'down' }).fetch }).near(ID)
    expect(noPrices).toMatchObject({ nearPrice: null, tokens: [], unpriced: 1, totalUsd: null, gaps: ['prices'] })
  })

  it('leaves a token unreviewed, and says so, when its review can’t be read', async () => {
    const { fetch } = fakeFetch({ tokens: [{ contract_id: 'usdc.near', balance: '1000000' }], prices: PRICES, reviews: { 'usdc.near': 'down' } })
    const portfolio = await createPortfolioReader({ rpc: fakeRpc(VIEW), fetch }).near(ID)
    expect(portfolio.tokens[0]?.trust).toBe('unreviewed')
    expect(portfolio.totalUsd).toBe(40)
    expect(portfolio.gaps).toEqual(['reviews'])
  })

  it('looks up only the most valuable tokens one by one', async () => {
    const many = Array.from({ length: MAX_REVIEWS + 10 }, (_, i) => `t${i}.near`)
    const prices = Object.fromEntries(many.map((contract, i) => [contract, { price: String(i + 1), symbol: `T${i}`, decimal: 0 }]))
    const { fetch, asked } = fakeFetch({ tokens: many.map((contract_id) => ({ contract_id, balance: '1' })), prices: { ...prices, ...PRICES } })
    const portfolio = await createPortfolioReader({ rpc: fakeRpc(VIEW), fetch }).near(ID)
    const looked = asked.filter((url) => url.includes('token_id=') && !url.includes('wrap.near'))
    expect(looked).toHaveLength(MAX_REVIEWS)
    expect(looked).not.toContain('https://prices.intear.tech/token?token_id=t0.near')
    expect(portfolio.tokens).toHaveLength(MAX_REVIEWS + 10)
  })

  it('counts a reviewed token on a thin market at what selling it would fetch', async () => {
    const { fetch } = fakeFetch({
      tokens: [
        { contract_id: 'usdc.near', balance: '100000000' },
        { contract_id: 'meme.near', balance: '80000000000000000000' },
      ],
      prices: PRICES,
      reviews: { 'usdc.near': 'Reputable', 'meme.near': 'NotFake' },
      liquidity: { 'usdc.near': 1_000_000, 'meme.near': 80 },
    })
    const portfolio = await createPortfolioReader({ rpc: fakeRpc(VIEW), fetch }).near(ID)
    expect(portfolio.tokens.map(({ symbol, usdValue, countedUsd }) => ({ symbol, usdValue, countedUsd }))).toEqual([
      { symbol: 'USDC', usdValue: 100, countedUsd: 100 },
      // $40 of MEME into a pool with $40 on the other side fetches $20.
      { symbol: 'MEME', usdValue: 40, countedUsd: 20 },
    ])
    expect(portfolio.totalUsd).toBe(40 + 100 + 20)
  })

  it('throws when NEAR itself can’t be read', async () => {
    await expect(createPortfolioReader({ rpc: fakeRpc('down'), fetch: fakeFetch({}).fetch }).near(ID)).rejects.toThrow()
  })

  it('keeps a read for a minute, reads again when asked fresh, and shares one under way', async () => {
    let time = 0
    const { fetch, asked } = fakeFetch({ prices: PRICES })
    const reader = createPortfolioReader({ rpc: fakeRpc(VIEW), fetch, now: () => time })
    const lists = () => asked.filter((url) => url.endsWith('/list-token-price')).length

    await Promise.all([reader.near(ID), reader.near(ID, { fresh: true })])
    expect(lists()).toBe(1)
    time = PORTFOLIO_TTL_MS - 1
    await reader.near(ID)
    expect(lists()).toBe(1)
    await reader.near(ID, { fresh: true })
    expect(lists()).toBe(2)
    time += PORTFOLIO_TTL_MS
    await reader.near(ID)
    expect(lists()).toBe(3)
    // NEAR's own review is kept for an hour, so it was asked once.
    expect(asked.filter((url) => url.includes('token_id=wrap.near'))).toHaveLength(1)
  })

  it('doesn’t keep a failed read', async () => {
    let down = true
    const rpc = { viewAccount: async () => (down ? Promise.reject(new Error('down')) : VIEW), callView: async () => '0' } as unknown as NearRpc
    const reader = createPortfolioReader({ rpc, fetch: fakeFetch({ prices: PRICES }).fetch })
    await expect(reader.near(ID)).rejects.toThrow()
    down = false
    expect((await reader.near(ID)).totalUsd).toBe(40)
  })
})
