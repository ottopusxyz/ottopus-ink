import { describe, expect, it } from 'vitest'
import { checkZerionKey, networkName, toHolding, ZerionError, zerionHoldings, zerionTokenSearch } from './zerion'

const KEY = 'zk_dev_test_not_a_real_key_0001'
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

function position(overrides: Record<string, unknown> = {}, chain = 'base') {
  return {
    attributes: {
      quantity: { int: '1240000000', decimals: 6 },
      value: 1240,
      price: 1,
      changes: { absolute_1d: 0.4, percent_1d: 0.03 },
      fungible_info: {
        name: 'USD Coin',
        symbol: 'USDC',
        flags: { verified: true },
        implementations: [
          { chain_id: 'base', address: USDC_BASE, decimals: 6 },
          { chain_id: 'ethereum', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
        ],
      },
      flags: { displayable: true },
      ...overrides,
    },
    relationships: { chain: { data: { id: chain } } },
  }
}

/** Zerion by path, recording what was asked and with which header. */
function fakeZerion(answers: Record<string, { status?: number; body?: unknown; headers?: Record<string, string> }[]>) {
  const asked: { url: string; authorization: string }[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    asked.push({ url, authorization: (init.headers as Record<string, string>).authorization ?? '' })
    const path = url.replace('https://api.zerion.io/v1', '').split('?')[0]!
    const answer = answers[path]?.shift() ?? { status: 404 }
    return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), { status: answer.status ?? 200, headers: answer.headers })
  }) as unknown as typeof globalThis.fetch
  return { fetch, asked }
}

describe('a Zerion position', () => {
  it('becomes a holding on its chain, with the token’s address there', () => {
    expect(toHolding(position())).toEqual({
      network: 'base',
      networkName: 'Base',
      group: 'evm',
      contract: USDC_BASE,
      symbol: 'USDC',
      decimals: 6,
      raw: 1_240_000_000n,
      usdPrice: 1,
      usdValue: 1240,
      change24h: 0.0003,
      verified: true,
    })
  })

  it('is the chain’s own coin when it has no address there, and knows Solana and Tron', () => {
    const sol = position({ fungible_info: { symbol: 'SOL', flags: { verified: true }, implementations: [{ chain_id: 'solana', address: null }] } }, 'solana')
    expect(toHolding(sol)).toMatchObject({ group: 'solana', contract: null, symbol: 'SOL', networkName: 'Solana' })
    const trx = position({ fungible_info: { symbol: 'TRX', implementations: [{ chain_id: 'tron', address: '' }] } }, 'tron')
    expect(toHolding(trx)).toMatchObject({ group: 'tron', contract: null, verified: false })
  })

  it('is dropped when it can’t be named honestly', () => {
    expect(toHolding(position({ fungible_info: { symbol: 'Claim at https://example.test', implementations: [] } }))).toBeNull()
    expect(toHolding(position({ quantity: { int: '0', decimals: 6 } }))).toBeNull()
    expect(toHolding(position({ quantity: { int: '1.5', decimals: 6 } }))).toBeNull()
    expect(toHolding(position({ quantity: { int: '1', decimals: 99 } }))).toBeNull()
    expect(toHolding(position({ flags: { displayable: false } }))).toBeNull()
    expect(toHolding(position({}, 'Not A Chain'))).toBeNull()
    expect(toHolding({ attributes: {} })).toBeNull()
    expect(toHolding(null)).toBeNull()
  })

  it('names chains as people read them', () => {
    expect(networkName('binance-smart-chain')).toBe('BNB Chain')
    expect(networkName('arbitrum')).toBe('Arbitrum')
    expect(networkName('manta-pacific')).toBe('Manta Pacific')
  })
})

describe('reading an address from Zerion', () => {
  const path = `/wallets/0xabc/positions/`

  it('asks with the key, Zerion’s spam filter on, and follows its pages', async () => {
    const { fetch, asked } = fakeZerion({
      [path]: [
        { body: { data: [position()], links: { next: 'https://api.zerion.io/v1/wallets/0xabc/positions/?page=2' } } },
        { body: { data: [position({}, 'ethereum')], links: { next: null } } },
      ],
    })
    const holdings = await zerionHoldings('0xabc', { key: KEY, fetch })
    expect(holdings.map((holding) => holding.network)).toEqual(['base', 'ethereum'])
    expect(asked[0]!.url).toContain('filter%5Btrash%5D=only_non_trash')
    expect(asked[0]!.authorization).toBe(`Basic ${Buffer.from(`${KEY}:`).toString('base64')}`)
  })

  it('never follows a page link away from Zerion, so the key goes nowhere else', async () => {
    const { fetch, asked } = fakeZerion({ [path]: [{ body: { data: [position()], links: { next: 'https://example.test/steal' } } }] })
    await zerionHoldings('0xabc', { key: KEY, fetch })
    expect(asked).toHaveLength(1)
  })

  it('says why it couldn’t read', async () => {
    const reason = async (answers: Parameters<typeof fakeZerion>[0]) =>
      zerionHoldings('0xabc', { key: KEY, fetch: fakeZerion(answers).fetch }).then(
        () => 'read',
        (error: unknown) => (error instanceof ZerionError ? error.reason : 'other'),
      )
    expect(await reason({ [path]: [{ status: 401 }] })).toBe('bad-key')
    expect(await reason({ [path]: [{ status: 400, body: { errors: [{ detail: 'Address is not trackable' }] } }] })).toBe('untracked')
    expect(await reason({ [path]: [{ status: 429, headers: { 'retry-after': '60' } }] })).toBe('rate-limited')
    expect(await reason({ [path]: [{ status: 503 }] })).toBe('unavailable')
    expect(await reason({ [path]: [{ body: { nope: true } }] })).toBe('unavailable')
  })

  it('waits out a short rate limit once', async () => {
    const holdings = await zerionHoldings('0xabc', {
      key: KEY,
      fetch: fakeZerion({ [path]: [{ status: 429, headers: { 'retry-after': '0.1' } }, { body: { data: [position()] } }] }).fetch,
    })
    expect(holdings).toHaveLength(1)
  })
})

describe('checking a key', () => {
  it('is ok when Zerion answers, bad when it refuses, and unavailable otherwise', async () => {
    expect(await checkZerionKey({ key: KEY, fetch: fakeZerion({ '/chains/': [{ body: { data: [] } }] }).fetch })).toBe('ok')
    expect(await checkZerionKey({ key: KEY, fetch: fakeZerion({ '/chains/': [{ status: 401 }] }).fetch })).toBe('bad-key')
    expect(await checkZerionKey({ key: KEY, fetch: fakeZerion({ '/chains/': [{ status: 500 }] }).fetch })).toBe('unavailable')
  })
})

describe('searching Zerion’s tokens on a chain', () => {
  const fungible = (symbol: string, attributes: Record<string, unknown> = {}) => ({ attributes: { symbol, name: `${symbol} token`, flags: { verified: true }, icon: { url: `https://cdn.zerion.io/${symbol.toLowerCase()}.png` }, ...attributes } })

  it('gives verified tokens with their names and icons on Zerion’s image host only', async () => {
    const { fetch } = fakeZerion({
      '/fungibles/': [
        {
          body: {
            data: [
              fungible('DEGEN'),
              fungible('AERO', { icon: { url: 'https://tracker.example.test/aero.png' } }),
              fungible('NOICON', { icon: null }),
              fungible('FAKE', { flags: { verified: false } }),
            ],
          },
        },
      ],
    })
    expect(await zerionTokenSearch('e', 'base', { key: KEY, fetch })).toEqual([
      { symbol: 'DEGEN', name: 'DEGEN token', icon: 'https://cdn.zerion.io/degen.png' },
      { symbol: 'AERO', name: 'AERO token', icon: null },
      { symbol: 'NOICON', name: 'NOICON token', icon: null },
    ])
  })
})
