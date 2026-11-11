import { describe, expect, it } from 'vitest'
import type { Portfolio, TokenHolding } from '../../../shared/portfolio'
import { portfolioFailure, portfolioView, readAgo, shareBar, shortAmount, spread } from './portfolio'

const token = (symbol: string, amount: string, usdValue: number, trust: TokenHolding['trust'] = 'reviewed', countedUsd = trust === 'reviewed' ? usdValue : 0): TokenHolding => ({
  id: `near:${symbol.toLowerCase()}.near`,
  group: 'near',
  network: 'near',
  networkName: 'NEAR',
  contract: `${symbol.toLowerCase()}.near`,
  symbol,
  decimals: 6,
  amount,
  price: { usd: 1, change24h: null },
  usdValue,
  countedUsd,
  trust,
})

const PORTFOLIO: Portfolio = {
  near: {
    accountId: 'alice.near',
    onChain: true,
    available: '9.5',
    storage: '0.5',
    staked: '4',
    pools: [{ poolId: 'one.poolv1.near', staked: '4', unstaked: '1' }],
    stakingComplete: true,
  },
  nearPrice: { usd: 2, change24h: 0.01 },
  tokens: [token('USDC', '30', 30), token('MEME', '1000000', 500, 'reviewed', 100), token('FAKE', '5', 5, 'unreviewed')],
  zerion: 'off',
  zerionVia: null,
  unread: [],
  unpriced: 4,
  totalUsd: 20 + 10 + 30 + 100,
  readAt: 0,
  gaps: [],
}

describe('the Portfolio table', () => {
  it('puts NEAR, staked NEAR and each vouched-for token in rows, by what they count for', () => {
    const view = portfolioView(PORTFOLIO)
    expect(view.rows.map(({ id, symbol, label, amount, usd, counted, thin }) => ({ id, symbol, label, amount, usd, counted, thin }))).toEqual([
      { id: 'near:meme.near', symbol: 'MEME', label: 'Token on NEAR', amount: '1,000,000', usd: 500, counted: 100, thin: true },
      { id: 'near:usdc.near', symbol: 'USDC', label: 'Token on NEAR', amount: '30', usd: 30, counted: 30, thin: false },
      { id: 'near', symbol: 'NEAR', label: 'Native on NEAR', amount: '10', usd: 20, counted: 20, thin: false },
      // Staked, and waiting to be withdrawn.
      { id: 'near-staked', symbol: 'NEAR', label: 'Staked on NEAR', amount: '5', usd: 10, counted: 10, thin: false },
    ])
    expect(view.rows.reduce((total, row) => total + (row.share ?? 0), 0)).toBeCloseTo(1)
    expect(view.unreviewed.map((row) => ({ symbol: row.symbol, counted: row.counted, share: row.share }))).toEqual([{ symbol: 'FAKE', counted: 0, share: 0 }])
    expect(view.unpriced).toBe(4)
    expect(view.total).toBe(160)
  })

  it('has no staked row with nothing staked, and no values without NEAR’s price', () => {
    const view = portfolioView({ ...PORTFOLIO, near: { ...PORTFOLIO.near, staked: '0', pools: [] }, nearPrice: null, tokens: [], totalUsd: null })
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0]).toMatchObject({ id: 'near', usd: null, counted: 0, share: null })
  })

  it('names a Zerion holding by its chain, and a chain’s own coin as native', () => {
    const eth: TokenHolding = { ...token('ETH', '0.5', 1000), id: 'base:native', group: 'evm', network: 'base', networkName: 'Base', contract: null }
    const row = portfolioView({ ...PORTFOLIO, tokens: [eth] }).rows.find((item) => item.id === 'base:native')
    expect(row).toMatchObject({ group: 'evm', network: 'base', label: 'Native on Base', contract: null })
  })

  it('says where a token in the Intents balance came from', () => {
    const eth: TokenHolding = { ...token('ETH', '0.5', 1000), id: 'intents:nep141:eth.omft.near', group: 'intents', network: 'intents', networkName: 'NEAR Intents', contract: 'nep141:eth.omft.near', origin: 'Ethereum' }
    const row = portfolioView({ ...PORTFOLIO, tokens: [eth] }).rows.find((item) => item.group === 'intents')
    expect(row).toMatchObject({ label: 'In Intents, from Ethereum', network: 'intents' })
  })

  it('gives known tokens their brand colour', () => {
    const colors = Object.fromEntries(portfolioView(PORTFOLIO).rows.map((row) => [row.id, row.color]))
    expect(colors.near).toBe('#00EC97')
    expect(colors['near:usdc.near']).toBe('#2775CA')
  })
})

describe('how far a portfolio spreads', () => {
  it('names one chain, or counts several', () => {
    const view = portfolioView(PORTFOLIO)
    expect(spread(view.rows)).toBe('On NEAR so far')
    const eth: TokenHolding = { ...token('ETH', '0.5', 1000), id: 'base:native', group: 'evm', network: 'base', networkName: 'Base', contract: null }
    const wider = portfolioView({ ...PORTFOLIO, tokens: [...PORTFOLIO.tokens, eth] })
    expect(spread(wider.rows)).toBe('Across 2 chains')
  })
})

describe('the share bar', () => {
  it('shows the biggest few and puts the rest together', () => {
    const rows = portfolioView(PORTFOLIO).rows
    expect(shareBar(rows, 2).map((part) => part.label)).toEqual(['MEME', 'USDC', 'Other'])
    expect(shareBar(rows).map((part) => part.label)).toEqual(['MEME', 'USDC', 'NEAR', 'NEAR staked'])
  })
})

describe('amounts and times for the page', () => {
  it('cuts an amount to a few places, groups it, and shows dust as dust', () => {
    expect(shortAmount('652.90419240214108586287062')).toBe('652.9041')
    expect(shortAmount('200113363.269')).toBe('200,113,363.269')
    expect(shortAmount('0.000000000000000000000001')).toBe('<0.0001')
    expect(shortAmount('0')).toBe('0')
    expect(shortAmount('12')).toBe('12')
  })

  it('says how long ago the figures were read', () => {
    expect(readAgo(0, 4_000)).toBe('just now')
    expect(readAgo(0, 42_000)).toBe('42 seconds ago')
    expect(readAgo(0, 80_000)).toBe('a minute ago')
    expect(readAgo(0, 5 * 60_000)).toBe('5 minutes ago')
    expect(readAgo(10_000, 0)).toBe('just now')
  })

  it('says why there are no figures', () => {
    expect(portfolioFailure({ ok: false, reason: 'unavailable' })).toContain('couldn’t reach NEAR')
    expect(portfolioFailure({ ok: false, reason: 'locked' })).toContain('Unlock')
  })
})
