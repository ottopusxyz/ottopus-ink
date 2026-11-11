import { describe, expect, it } from 'vitest'
import { nearPriceList, nearTokenReview } from './near-prices'

const answer = (body: unknown, status = 200) => {
  const urls: string[] = []
  const fetch = (async (url: string) => {
    urls.push(url)
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof globalThis.fetch
  return { fetch, urls }
}

const offline = { fetch: (async () => Promise.reject(new Error('offline'))) as unknown as typeof globalThis.fetch }

describe('NEAR token prices', () => {
  it('keeps each token Intear prices above zero, by contract', async () => {
    const { fetch, urls } = answer({
      'wrap.near': { price: '3.68', symbol: 'wNEAR', decimal: 24 },
      'usdt.tether-token.near': { price: '1.000000000000', symbol: 'USDt', decimal: 6 },
      'dead.near': { price: '0', symbol: 'DEAD', decimal: 18 },
    })
    const prices = await nearPriceList({ fetch })
    expect([...(prices ?? [])]).toEqual([
      ['wrap.near', { symbol: 'wNEAR', decimals: 24, usd: 3.68 }],
      ['usdt.tether-token.near', { symbol: 'USDt', decimals: 6, usd: 1 }],
    ])
    expect(urls).toEqual(['https://prices.intear.tech/list-token-price'])
  })

  it('leaves out a token whose symbol reads as a message, or whose numbers make no sense', async () => {
    const prices = await nearPriceList(
      answer({
        'bait.near': { price: '1', symbol: 'You won 500 NEAR! Claim at https://example.test', decimal: 18 },
        'blank.near': { price: '1', symbol: '', decimal: 18 },
        'emoji.near': { price: '1', symbol: '🎉WIN', decimal: 18 },
        'deep.near': { price: '1', symbol: 'DEEP', decimal: 99 },
        'half.near': { price: '1', symbol: 'HALF', decimal: 1.5 },
        'nan.near': { price: 'lots', symbol: 'NAN', decimal: 18 },
        'ok.near': { price: '2', symbol: ' OK ', decimal: 18 },
      }),
    )
    expect([...(prices ?? [])]).toEqual([['ok.near', { symbol: 'OK', decimals: 18, usd: 2 }]])
  })

  it('is null when Intear fails or answers with something else', async () => {
    expect(await nearPriceList(answer({}, 503))).toBeNull()
    expect(await nearPriceList(answer([1, 2]))).toBeNull()
    expect(await nearPriceList(offline)).toBeNull()
  })
})

describe('a NEAR token’s review', () => {
  it('reads the reputation and the day’s change', async () => {
    const { fetch, urls } = answer({ account_id: 'wrap.near', reputation: 'Reputable', price_usd_raw: '0.0000000000000000036', price_usd_raw_24h_ago: '0.0000000000000000030' })
    const review = await nearTokenReview('wrap.near', { fetch })
    expect(review?.reputation).toBe('reputable')
    expect(review?.change24h).toBeCloseTo(0.2)
    expect(urls).toEqual(['https://prices.intear.tech/token?token_id=wrap.near'])
  })

  it('reads anything Ink doesn’t know as unknown, and has no change without both prices', async () => {
    expect(await nearTokenReview('a.near', answer({ account_id: 'a.near', reputation: 'NotFake' }))).toEqual({ reputation: 'not-fake', change24h: null })
    expect(await nearTokenReview('a.near', answer({ account_id: 'a.near', reputation: 'Spam' }))).toEqual({ reputation: 'spam', change24h: null })
    expect(await nearTokenReview('a.near', answer({ account_id: 'a.near', reputation: 'Trusted!' }))).toEqual({ reputation: 'unknown', change24h: null })
    expect(await nearTokenReview('a.near', answer({ account_id: 'a.near' }))).toEqual({ reputation: 'unknown', change24h: null })
  })

  it('is null for an answer about another token, a failure, or nothing useful', async () => {
    expect(await nearTokenReview('a.near', answer({ account_id: 'b.near', reputation: 'Reputable' }))).toBeNull()
    expect(await nearTokenReview('a.near', answer({}, 404))).toBeNull()
    expect(await nearTokenReview('a.near', offline)).toBeNull()
  })
})
