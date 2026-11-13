import { describe, expect, it } from 'vitest'
import { depositAddress, depositChains } from './deposits'

/** The bridge as a JSON-RPC server: one answer for each method, or a function of what was asked. */
function bridge(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const asked: { method: string; params: Record<string, unknown> }[] = []
  const fetch = (async (_url: string, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown>[] }
    asked.push({ method, params: params[0] ?? {} })
    const answer = answers[method]
    return answer ? new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, ...(answer(params[0] ?? {}) as object) })) : new Response('down', { status: 503 })
  }) as unknown as typeof globalThis.fetch
  return { fetch, asked }
}

const token = (id: string, name: string, decimals: number, min: string) => ({ defuse_asset_identifier: id, asset_name: name, decimals, min_deposit_amount: min })

describe('the chains NEAR Intents takes deposits on', () => {
  it('lists each known chain by name, with its tokens and the least of each it credits', async () => {
    const { fetch } = bridge({
      supported_tokens: () => ({
        result: {
          tokens: [
            token('eth:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USDC', 6, '1000000'),
            token('eth:8453:native', 'ETH', 18, '100000000000'),
            token('btc:mainnet:native', 'BTC', 8, '5000'),
            token('btc:mainnet:native', 'BTC', 8, '7000'),
            token('qtc:mainnet:native', 'QTC', 8, '1'),
          ],
        },
      }),
    })
    expect(await depositChains({ fetch })).toEqual([
      { key: 'eth:8453', name: 'Base', mark: 'base', tokens: [{ symbol: 'ETH', min: '0.0000001' }, { symbol: 'USDC', min: '1' }] },
      // Listed twice: the higher minimum, so a deposit that meets it is credited either way.
      { key: 'btc:mainnet', name: 'Bitcoin', mark: 'bitcoin', tokens: [{ symbol: 'BTC', min: '0.00007' }] },
    ])
  })

  it('leaves out symbols that aren’t one word and odd amounts, and is null when the bridge can’t be read', async () => {
    const { fetch } = bridge({ supported_tokens: () => ({ result: { tokens: [token('eth:8453:x', 'Claim at example.test', 6, '1'), token('eth:8453:y', 'USDC', 6, '1.5')] } }) })
    expect(await depositChains({ fetch })).toEqual([])
    expect(await depositChains(bridge({}))).toBeNull()
  })
})

describe('the account’s deposit address on a chain', () => {
  it('asks the bridge for the account’s address on that chain', async () => {
    const { fetch, asked } = bridge({ deposit_address: (params) => ({ result: { address: '0x8f436D184823B77188DE973322278686c3780C2c', chain: params.chain } }) })
    expect(await depositAddress('a'.repeat(64), 'eth:8453', { fetch })).toEqual({ address: '0x8f436D184823B77188DE973322278686c3780C2c', memo: null })
    expect(asked).toEqual([{ method: 'deposit_address', params: { account_id: 'a'.repeat(64), chain: 'eth:8453' } }])
  })

  it('asks again in memo form for a chain that needs one, and gives the memo', async () => {
    const { fetch, asked } = bridge({
      deposit_address: (params) => (params.deposit_mode === 'MEMO' ? { result: { address: 'GDJ4JZXZELZD737NVFORH4PSSQDWFDZTKW3AIDKHYQG23ZXBPDGGQBJK', chain: params.chain, memo: '177237517' } } : { error: 'Deposit mode MEMO is required for this chain' }),
    })
    expect(await depositAddress('a'.repeat(64), 'stellar:mainnet', { fetch })).toEqual({ address: 'GDJ4JZXZELZD737NVFORH4PSSQDWFDZTKW3AIDKHYQG23ZXBPDGGQBJK', memo: '177237517' })
    expect(asked.map((ask) => ask.params.deposit_mode ?? null)).toEqual([null, 'MEMO'])
  })

  it('refuses a chain Ink doesn’t list, an answer for another chain, and anything that isn’t an address', async () => {
    const asked = bridge({ deposit_address: () => ({ result: { address: '0x8f436D184823B77188DE973322278686c3780C2c', chain: 'eth:1' } }) })
    expect(await depositAddress('a'.repeat(64), 'qtc:mainnet', asked)).toBeNull()
    expect(asked.asked).toEqual([])
    expect(await depositAddress('a'.repeat(64), 'eth:8453', asked)).toBeNull()
    expect(await depositAddress('a'.repeat(64), 'eth:8453', bridge({ deposit_address: (params) => ({ result: { address: 'send it to me', chain: params.chain } }) }))).toBeNull()
    expect(await depositAddress('a'.repeat(64), 'eth:8453', bridge({}))).toBeNull()
  })
})
