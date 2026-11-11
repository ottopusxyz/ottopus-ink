import { describe, expect, it } from 'vitest'
import type { NearRpc } from '../near/rpc'
import { intentsBalances, intentsTokenList, originName } from './intents'

/** intents.near as a view contract: the tokens it lists for the account, and their balances. */
function fakeIntents(listed: unknown[] | 'down', balances: Record<string, string> = {}) {
  const calls: { method: string; args: unknown }[] = []
  const rpc = {
    callView: async (contract: string, method: string, args: { from_index?: string; token_ids?: string[] }) => {
      calls.push({ method, args })
      if (contract !== 'intents.near' || listed === 'down') throw new Error('no RPC answered')
      if (method === 'mt_tokens_for_owner') {
        const from = Number(args.from_index)
        return listed.slice(from, from + 100)
      }
      return (args.token_ids ?? []).map((id) => balances[id] ?? '0')
    },
  } as unknown as NearRpc
  return { rpc, calls }
}

describe('the Intents balance', () => {
  it('lists the account’s tokens on intents.near and keeps those above zero', async () => {
    const { rpc, calls } = fakeIntents([{ token_id: 'nep141:eth.omft.near' }, { token_id: 'nep141:wrap.near' }, { token_id: 'nep245:v2_1.omni.hot.tg:56_11111111111111111111' }], {
      'nep141:eth.omft.near': '500000000000000000',
      'nep245:v2_1.omni.hot.tg:56_11111111111111111111': '42',
    })
    expect(await intentsBalances('alice.near', { rpc })).toEqual([
      { tokenId: 'nep141:eth.omft.near', raw: 5n * 10n ** 17n },
      { tokenId: 'nep245:v2_1.omni.hot.tg:56_11111111111111111111', raw: 42n },
    ])
    expect(calls.map((call) => call.method)).toEqual(['mt_tokens_for_owner', 'mt_batch_balance_of'])
  })

  it('leaves out NFTs, odd ids and amounts that aren’t whole numbers', async () => {
    const { rpc } = fakeIntents([{ token_id: 'nep171:some.nft:1' }, { token_id: 'not an id' }, { token_id: 'nep141:frac.near' }, null, { token_id: 'nep141:ok.near' }], {
      'nep141:frac.near': '1.5',
      'nep141:ok.near': '7',
    })
    expect(await intentsBalances('alice.near', { rpc })).toEqual([{ tokenId: 'nep141:ok.near', raw: 7n }])
  })

  it('reads every page of a long list', async () => {
    const listed = Array.from({ length: 150 }, (_, i) => ({ token_id: `nep141:t${i}.near` }))
    const { rpc, calls } = fakeIntents(listed, Object.fromEntries(listed.map((entry) => [entry.token_id, '1'])))
    expect(await intentsBalances('alice.near', { rpc })).toHaveLength(150)
    expect(calls.filter((call) => call.method === 'mt_tokens_for_owner')).toHaveLength(2)
    expect(calls.filter((call) => call.method === 'mt_batch_balance_of')).toHaveLength(2)
  })

  it('is empty with nothing held, and null when NEAR can’t be read', async () => {
    expect(await intentsBalances('alice.near', fakeIntents([]))).toEqual([])
    expect(await intentsBalances('alice.near', fakeIntents('down'))).toBeNull()
  })
})

describe('1Click’s token list', () => {
  const answer = (body: unknown, status = 200) => ({ fetch: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof globalThis.fetch })

  it('names and prices each token by its Intents id, with the chain it came from', async () => {
    const tokens = await intentsTokenList(
      answer([
        { assetId: 'nep141:eth.omft.near', decimals: 18, blockchain: 'eth', symbol: 'ETH', price: 2054.73 },
        { assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', decimals: 6, blockchain: 'base', symbol: 'USDC', price: 1 },
        { assetId: 'nep141:old.near', decimals: 6, blockchain: 'near', symbol: 'USDT(DEPRECATED)', price: 0 },
      ]),
    )
    expect(tokens?.get('nep141:eth.omft.near')).toEqual({ symbol: 'ETH', decimals: 18, usd: 2054.73, origin: 'Ethereum' })
    expect(tokens?.get('nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near')?.origin).toBe('Base')
    // The tag goes, and with no price the token is known but not valued.
    expect(tokens?.get('nep141:old.near')).toEqual({ symbol: 'USDT', decimals: 6, usd: null, origin: 'NEAR' })
  })

  it('leaves out what it can’t name, and is null when 1Click fails', async () => {
    const tokens = await intentsTokenList(
      answer([
        { assetId: '1cs_v1:something', decimals: 6, blockchain: 'near', symbol: 'X', price: 1 },
        { assetId: 'nep141:bait.near', decimals: 6, blockchain: 'near', symbol: 'Claim at https://example.test', price: 1 },
        { assetId: 'nep141:deep.near', decimals: 99, blockchain: 'near', symbol: 'DEEP', price: 1 },
      ]),
    )
    expect(tokens?.size).toBe(0)
    expect(await intentsTokenList(answer({}, 500))).toBeNull()
    expect(await intentsTokenList(answer({ tokens: [] }))).toBeNull()
  })

  it('names chains as people read them', () => {
    expect(originName('btc')).toBe('Bitcoin')
    expect(originName('newchain')).toBe('NEWCHAIN')
  })
})
