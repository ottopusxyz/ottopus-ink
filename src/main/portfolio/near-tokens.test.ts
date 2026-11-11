import { describe, expect, it } from 'vitest'
import { MAX_TOKENS, nearTokenBalances } from './near-tokens'

const answer = (body: unknown, status = 200) => {
  const urls: string[] = []
  const fetch = (async (url: string) => {
    urls.push(url)
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof globalThis.fetch
  return { fetch, urls }
}

describe('the NEP-141 tokens a NEAR account holds', () => {
  it('asks FastNEAR for the account and keeps each token with a balance', async () => {
    const { fetch, urls } = answer({
      account_id: 'alice.near',
      tokens: [
        { contract_id: 'usdt.tether-token.near', last_update_block_height: 1, balance: '2500000' },
        { contract_id: 'wrap.near', last_update_block_height: null, balance: '1000000000000000000000000' },
      ],
    })
    expect(await nearTokenBalances('alice.near', { fetch })).toEqual([
      { contract: 'usdt.tether-token.near', raw: 2_500_000n },
      { contract: 'wrap.near', raw: 10n ** 24n },
    ])
    expect(urls).toEqual(['https://api.fastnear.com/v1/account/alice.near/ft'])
  })

  it('leaves out zero balances, repeats, and anything that is not an account and a whole number', async () => {
    const { fetch } = answer({
      tokens: [
        { contract_id: 'gone.near', balance: '0' },
        { contract_id: 'Not An Account', balance: '5' },
        { contract_id: 'neg.near', balance: '-5' },
        { contract_id: 'frac.near', balance: '1.5' },
        { contract_id: 'lead.near', balance: '05' },
        { contract_id: 'num.near', balance: 5 },
        null,
        { contract_id: 'kept.near', balance: '7' },
        { contract_id: 'kept.near', balance: '9' },
      ],
    })
    expect(await nearTokenBalances('alice.near', { fetch })).toEqual([{ contract: 'kept.near', raw: 7n }])
  })

  it('stops at a cap, so a flood of airdrops is not read one by one', async () => {
    const tokens = Array.from({ length: MAX_TOKENS + 50 }, (_, i) => ({ contract_id: `t${i}.near`, balance: '1' }))
    expect(await nearTokenBalances('alice.near', answer({ tokens }))).toHaveLength(MAX_TOKENS)
  })

  it('is null when the index fails or answers with something else', async () => {
    expect(await nearTokenBalances('alice.near', answer({}, 500))).toBeNull()
    expect(await nearTokenBalances('alice.near', answer({ tokens: 'no' }))).toBeNull()
    expect(await nearTokenBalances('alice.near', answer(null))).toBeNull()
    const broken = (async () => Promise.reject(new Error('offline'))) as unknown as typeof globalThis.fetch
    expect(await nearTokenBalances('alice.near', { fetch: broken })).toBeNull()
  })
})
