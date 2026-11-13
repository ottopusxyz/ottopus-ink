import { describe, expect, it } from 'vitest'
import { createApp, type AnswerCache, type Limiter, type ServiceDeps } from './app'
import { trimPosition } from './zerion'

const KEY = 'zk_dev_test_not_a_real_key_0001'
const EVM = '0x00000000000000000000000000000000000000aa'
const INSTALL = 'install_test_0123456789'

function position(symbol = 'USDC') {
  return {
    type: 'positions',
    id: 'x',
    attributes: {
      name: 'Asset',
      quantity: { int: '1240000000', decimals: 6, float: 1240, numeric: '1240' },
      value: 1240,
      price: 1,
      changes: { absolute_1d: 0.4, percent_1d: 0.03 },
      flags: { displayable: true, is_trash: false },
      fungible_info: {
        name: 'USD Coin',
        symbol,
        icon: { url: 'https://cdn.example.test/usdc.png' },
        flags: { verified: true },
        implementations: [{ chain_id: 'base', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 }],
      },
      application_metadata: { name: 'Something' },
    },
    relationships: { chain: { data: { type: 'chains', id: 'base' } }, fungible: { data: { id: 'usdc' } } },
  }
}

/** Limiters that allow until told otherwise, a Map for a cache, and Zerion by status. */
function world(zerion: { status?: number; body?: unknown; headers?: Record<string, string> }[] = [{ body: { data: [position()], links: { next: null } } }]) {
  const asked: { url: string; authorization: string | null }[] = []
  const limited = { ip: false, install: false }
  const limits: string[] = []
  const limiter = (which: 'ip' | 'install'): Limiter => ({
    limit: async ({ key }) => {
      limits.push(`${which}:${key}`)
      return { success: !limited[which] }
    },
  })
  const stored = new Map<string, string>()
  const cache: AnswerCache = {
    match: async (key) => (stored.has(key.url) ? new Response(stored.get(key.url)) : undefined),
    put: async (key, response) => void stored.set(key.url, await response.text()),
  }
  const fetch = (async (url: string, init: RequestInit) => {
    asked.push({ url, authorization: new Headers(init.headers).get('authorization') })
    const answer = zerion.shift() ?? { status: 500 }
    return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), { status: answer.status ?? 200, headers: answer.headers })
  }) as unknown as typeof globalThis.fetch
  const deps: ServiceDeps = { zerionKey: KEY, perIp: limiter('ip'), perInstall: limiter('install'), cache, fetch }
  const call = (path: string, headers: Record<string, string> = { 'x-ink-install': INSTALL, 'cf-connecting-ip': '203.0.113.7' }) =>
    createApp(deps).fetch(new Request(`https://service.test${path}`, { headers }))
  return { deps, call, asked, limited, limits, stored }
}

const positions = (address = EVM) => `/v1/zerion/wallets/${address}/positions/`

describe('the Zerion route', () => {
  it('asks Zerion with Ottopus’s key and a fixed query, and answers in Zerion’s shape, trimmed', async () => {
    const { call, asked } = world()
    const response = await call(`${positions()}?filter[positions]=no_filter&evil=1`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: unknown[]; links: { next: null } }
    expect(body.links.next).toBeNull()
    expect(body.data).toEqual([trimPosition(position())])
    expect(JSON.stringify(body)).not.toContain('cdn.example.test')
    expect(JSON.stringify(body)).not.toContain(KEY)
    expect(asked).toHaveLength(1)
    expect(asked[0]!.url).toBe(`https://api.zerion.io/v1/wallets/${EVM}/positions/?currency=usd&filter%5Bpositions%5D=only_simple&filter%5Btrash%5D=only_non_trash&sort=-value`)
    expect(asked[0]!.authorization).toBe(`Basic ${btoa(`${KEY}:`)}`)
  })

  it('keeps an address’s answer, in any letter case, so asking again costs no Zerion call', async () => {
    const { call, asked } = world()
    expect((await call(positions())).headers.get('x-ink-cache')).toBe('miss')
    const again = await call(positions(EVM.toUpperCase().replace('0X', '0x')))
    expect(again.headers.get('x-ink-cache')).toBe('hit')
    expect(asked).toHaveLength(1)
  })

  it('follows Zerion’s pages, and never a link away from Zerion', async () => {
    const { call, asked } = world([
      { body: { data: [position('A')], links: { next: `https://api.zerion.io/v1/wallets/${EVM}/positions/?page=2` } } },
      { body: { data: [position('B')], links: { next: 'https://example.test/steal' } } },
    ])
    const body = (await (await call(positions())).json()) as { data: { attributes: { fungible_info: { symbol: string } } }[] }
    expect(body.data.map((item) => item.attributes.fungible_info.symbol)).toEqual(['A', 'B'])
    expect(asked).toHaveLength(2)
  })

  it('takes EVM, Solana and Tron addresses, and nothing else', async () => {
    for (const address of [EVM, 'So11111111111111111111111111111111111111112', 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf']) expect((await world().call(positions(address))).status).toBe(200)
    for (const address of ['alice.near', '0x123', 'bad%20address', '0'.repeat(80)]) expect((await world().call(positions(address))).status).toBe(400)
  })

  it('limits each IP and each install, and turns down an install id that isn’t one', async () => {
    const byIp = world()
    byIp.limited.ip = true
    expect((await byIp.call(positions())).status).toBe(429)
    const byInstall = world()
    byInstall.limited.install = true
    expect((await byInstall.call(positions())).status).toBe(429)
    expect(byInstall.limits).toContain(`install:${INSTALL}`)
    expect((await world().call(positions(), { 'x-ink-install': 'no spaces allowed' })).status).toBe(400)
    // No install id is allowed: then only the IP's limit applies.
    expect((await world().call(positions(), {})).status).toBe(200)
  })

  it('passes on what Zerion said in terms Ink already reads, and never that the key was refused', async () => {
    const status = async (zerion: Parameters<typeof world>[0]) => (await world(zerion).call(positions())).status
    expect(await status([{ status: 400, body: { errors: [{ detail: 'Address is not trackable' }] } }])).toBe(400)
    expect(await status([{ status: 429, headers: { 'retry-after': '5' } }])).toBe(429)
    expect(await status([{ status: 401 }])).toBe(503)
    expect(await status([{ status: 500 }])).toBe(503)
    expect(await status([{ body: { nope: true } }])).toBe(503)
  })

  it('is off without a key, and keeps nothing it didn’t get', async () => {
    const { deps, call, stored } = world([{ status: 500 }])
    expect((await call(positions())).status).toBe(503)
    expect(stored.size).toBe(0)
    deps.zerionKey = undefined
    expect((await call(positions())).status).toBe(503)
    expect(await (await call('/v1/health')).json()).toEqual({ ok: true, zerion: 'off' })
  })

  it('has no other routes', async () => {
    expect((await world().call('/v1/zerion/chains/')).status).toBe(404)
    expect((await world().call('/')).status).toBe(404)
  })
})

describe('the token search route', () => {
  const fungible = (symbol: string, chains: string[]) => ({
    type: 'fungibles',
    id: symbol.toLowerCase(),
    attributes: {
      name: `${symbol} token`,
      symbol,
      icon: { url: symbol === 'USDC' ? 'https://cdn.zerion.io/usdc.png' : 'https://cdn.example.test/icon.png' },
      flags: { verified: true },
      market_data: { price: 1, market_cap: 1_000_000 },
      implementations: chains.map((chain) => ({ chain_id: chain, address: `0x${'1'.repeat(40)}`, decimals: 6 })),
    },
  })
  const search = (query: string, chain = 'base') => `/v1/zerion/fungibles?q=${encodeURIComponent(query)}&chain=${chain}`

  it('searches Zerion’s tokens on one chain, largest first, trimmed to that chain', async () => {
    const { call, asked } = world([{ body: { data: [fungible('USDC', ['base', 'ethereum']), fungible('NOPE', ['ethereum']), fungible('USDT', ['base'])] } }])
    const response = await call(search('usd'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        { attributes: { symbol: 'USDC', name: 'USDC token', flags: { verified: true }, icon: { url: 'https://cdn.zerion.io/usdc.png' }, implementations: [{ chain_id: 'base', address: `0x${'1'.repeat(40)}`, decimals: 6 }] } },
        // An icon anywhere but Zerion's image hosts is dropped.
        { attributes: { symbol: 'USDT', name: 'USDT token', flags: { verified: true }, implementations: [{ chain_id: 'base', address: `0x${'1'.repeat(40)}`, decimals: 6 }] } },
      ],
    })
    expect(asked[0]!.url).toBe('https://api.zerion.io/v1/fungibles/?filter%5Bsearch_query%5D=usd&filter%5Bimplementation_chain_id%5D=base&page%5Bsize%5D=20&sort=-market_data.market_cap&currency=usd')
    expect(asked[0]!.authorization).toBe(`Basic ${btoa(`${KEY}:`)}`)
  })

  it('keeps a search’s answer a while, in any letter case', async () => {
    const { call, asked } = world([{ body: { data: [fungible('USDC', ['base'])] } }])
    expect((await call(search('USDC'))).headers.get('x-ink-cache')).toBe('miss')
    expect((await call(search('usdc'))).headers.get('x-ink-cache')).toBe('hit')
    expect(asked).toHaveLength(1)
  })

  it('takes a few letters on one named chain, and nothing else', async () => {
    for (const path of [search(''), search('a'.repeat(33)), search('<script>'), search('usdc', 'Base'), '/v1/zerion/fungibles?q=usdc']) expect((await world().call(path)).status).toBe(400)
  })

  it('is limited like the holdings route, and off without a key', async () => {
    const limited = world()
    limited.limited.ip = true
    expect((await limited.call(search('usdc'))).status).toBe(429)
    expect((await world([{ status: 401 }]).call(search('usdc'))).status).toBe(503)
    const off = world()
    off.deps.zerionKey = undefined
    expect((await off.call(search('usdc'))).status).toBe(503)
  })
})
