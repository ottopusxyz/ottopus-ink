import { describe, expect, it } from 'vitest'
import type { ReviewPlan, ReviewToken } from '../../shared/review'
import type { ZerionToken } from '../portfolio/zerion'
import type { OneClickToken } from '../routes/one-click'
import { withReviewIcons } from './icons'

const DAI = '0x50c5725949a6f0c72e6c4a641f24049a917db0cb'
const token = (symbol: string, chain: string, id: string | null): ReviewToken => ({ symbol, chain, place: chain, id, icon: null })

/** A plan that sends `out` and pays out `arrives`, with one transaction moving `out`. */
function planOf(out: ReviewToken, arrives: ReviewToken): ReviewPlan {
  const action = { kind: 'FunctionCall' as const, amount: '0', attachAsset: 'ETH', method: 'transfer', summary: '', move: { amount: '1', token: out, to: '0xdead', role: 'deposit' as const } }
  return {
    actions: [action],
    flow: { out: [{ token: out, amount: '1' }], via: 'intents', in: { token: arrives, amount: '1', exact: true, to: 'x' } },
    transactions: [{ chain: { mark: out.chain, name: out.chain }, key: 'secp256k1', when: 'now', maxFee: null, feeAsset: 'ETH', actions: [action] }],
  } as unknown as ReviewPlan
}

const found = (symbol: string, addresses: (string | null)[], icon = `https://cdn.zerion.io/${addresses[0] ?? 'native'}.png`): ZerionToken => ({ symbol, name: null, icon, addresses })
const asData = async (url: string) => `data:image/png;base64,${Buffer.from(url).toString('base64')}`

describe('icons in the review window', () => {
  it('asks nothing for tokens Ink ships a logo for', async () => {
    const plan = planOf(token('USDC', 'base', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'), token('NEAR', 'near', null))
    let asked = 0
    const out = await withReviewIcons(plan, { tokens: async () => [], search: async () => (asked++, []), icon: asData })
    expect(out).toBe(plan)
    expect(asked).toBe(0)
  })

  it('takes the icon of the verified token with the exact contract the plan checked, never one that only shares its symbol', async () => {
    const plan = planOf(token('DAI', 'base', DAI.toUpperCase().replace('0X', '0x')), token('USDC', 'solana', null))
    const searched: string[] = []
    const out = await withReviewIcons(plan, {
      tokens: async () => [],
      search: async (symbol, chain) => (searched.push(`${symbol}@${chain}`), [found('DAI', ['0x1111111111111111111111111111111111111111'], 'https://cdn.zerion.io/fake.png'), found('DAI', [DAI])]),
      icon: asData,
    })
    expect(searched).toEqual(['DAI@base'])
    const icon = await asData(`https://cdn.zerion.io/${DAI}.png`)
    // Everywhere the token appears: the money map and the action that moves it.
    expect(out.flow.out[0]?.token.icon).toBe(icon)
    expect(out.transactions[0]?.actions[0]?.move?.token.icon).toBe(icon)
    expect(out.actions[0]?.move?.token.icon).toBe(icon)
  })

  it('reads a 1Click id as its token on its own chain, and a chain’s coin as Zerion’s token with no address', async () => {
    const listed: OneClickToken[] = [{ assetId: 'nep141:base-0xdai.omft.near', symbol: 'DAI', decimals: 18, blockchain: 'base', contract: DAI, usd: 1 }]
    const plan = planOf(token('BNB', 'bsc', null), { ...token('DAI', 'base', 'nep141:base-0xdai.omft.near'), place: 'NEAR Intents' })
    const out = await withReviewIcons(plan, {
      tokens: async () => listed,
      search: async (symbol, chain) => (chain === 'binance-smart-chain' && symbol === 'BNB' ? [found('BNB', [null])] : chain === 'base' && symbol === 'DAI' ? [found('DAI', [DAI])] : []),
      icon: asData,
    })
    expect(out.flow.out[0]?.token.icon).toBe(await asData('https://cdn.zerion.io/native.png'))
    expect(out.flow.in.token.icon).toBe(await asData(`https://cdn.zerion.io/${DAI}.png`))
  })

  it('leaves a token without an icon when Zerion has no match, can’t answer, or answers too late', async () => {
    const plan = planOf(token('DAI', 'base', DAI), token('XYZ', 'near', 'nep141:xyz.near'))
    const none = await withReviewIcons(plan, { tokens: async () => [], search: async () => [found('DAI', ['0x2222222222222222222222222222222222222222'])], icon: asData })
    expect(none).toBe(plan)
    const broken = await withReviewIcons(plan, { tokens: async () => null, search: async () => Promise.reject(new Error('down')), icon: asData })
    expect(broken).toBe(plan)
    const started = Date.now()
    const slow = await withReviewIcons(plan, { tokens: async () => [], search: () => new Promise(() => {}), icon: asData, timeoutMs: 30 })
    expect(slow).toBe(plan)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
