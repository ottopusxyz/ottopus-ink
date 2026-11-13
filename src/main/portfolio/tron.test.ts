import { describe, expect, it } from 'vitest'
import { tronHoldings } from './tron'

const ADDRESS = 'TJCo98saj6WND61g1uuKwJ9GMWMT9WkJFo'
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

const answer = (body: unknown, status = 200) => {
  const urls: string[] = []
  const fetch = (async (url: string) => {
    urls.push(url)
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof globalThis.fetch
  return { fetch, urls }
}

describe('a Tron address’s holdings', () => {
  it('reads TRX, frozen TRX included, and each TRC-20 token with a balance', async () => {
    const { fetch, urls } = answer({
      data: [
        {
          balance: 2_500_000,
          frozenV2: [{ amount: 1_000_000 }, { type: 'ENERGY', amount: 500_000 }, { type: 'TRON_POWER' }],
          trc20: [{ [USDT]: '12000000' }, { TL81r5Zze7Av4DiKxCBzCbtDnUQVSQfm82: '0' }],
        },
      ],
    })
    expect(await tronHoldings(ADDRESS, { fetch })).toEqual({ trx: 4_000_000n, tokens: [{ contract: USDT, raw: 12_000_000n }] })
    expect(urls).toEqual([`https://api.trongrid.io/v1/accounts/${ADDRESS}`])
  })

  it('holds nothing at an address nothing was sent to', async () => {
    expect(await tronHoldings(ADDRESS, answer({ data: [], success: true }))).toEqual({ trx: 0n, tokens: [] })
  })

  it('leaves out tokens that aren’t addresses and amounts that aren’t whole numbers', async () => {
    const holdings = await tronHoldings(ADDRESS, answer({ data: [{ balance: 0, trc20: [{ 'not a contract': '5' }, { [USDT]: '1.5' }, { TL81r5Zze7Av4DiKxCBzCbtDnUQVSQfm82: '7' }] }] }))
    expect(holdings?.tokens).toEqual([{ contract: 'TL81r5Zze7Av4DiKxCBzCbtDnUQVSQfm82', raw: 7n }])
  })

  it('is null when TronGrid fails, answers oddly, or the address isn’t a Tron one', async () => {
    expect(await tronHoldings(ADDRESS, answer({}, 503))).toBeNull()
    expect(await tronHoldings(ADDRESS, answer({ data: 'no' }))).toBeNull()
    expect(await tronHoldings(ADDRESS, answer({ data: [{ balance: -1 }] }))).toBeNull()
    expect(await tronHoldings('0x00000000000000000000000000000000000000aa', answer({ data: [] }))).toBeNull()
  })
})
