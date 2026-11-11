import { parseNear, formatNear } from '../../../shared/near/units'
import type { HoldingGroup, Portfolio, PortfolioResult, TokenHolding } from '../../../shared/portfolio'
import { formatAmount } from './format'

/** One line of the Portfolio table. */
export interface PortfolioRow {
  /** `near`, `near-staked`, or the token's chain and contract. */
  id: string
  /** The account that holds it, for the chain chips. */
  group: HoldingGroup
  /** The chain it's on: `near`, `base`. */
  network: string
  symbol: string
  /** What it is and where: "Native on NEAR". */
  label: string
  /** Short, for a table cell. The exact amount is `exact`. */
  amount: string
  exact: string
  /** At the market price; null without one. */
  usd: number | null
  /** What it adds to the total. */
  counted: number
  /** Of the total, 0 to 1; null without a total. */
  share: number | null
  color: string
  /** True when a thin market made it count for less than its price says. */
  thin: boolean
  contract: string | null
}

export interface PortfolioView {
  /** Counted toward the total, most valuable first. */
  rows: PortfolioRow[]
  /** Priced, but nobody vouches for them. Never in the total. */
  unreviewed: PortfolioRow[]
  unpriced: number
  total: number | null
}

/** Brand colours for the share bar where a mark has one; others take turns from a calm set. */
const COLORS: Record<string, string> = { NEAR: '#00EC97', USDC: '#2775CA', USDT: '#26A17B', ETH: '#627EEA', WETH: '#627EEA', BTC: '#F7931A', NBTC: '#F7931A', SOL: '#9945FF' }
const STAKED = '#0A8F5F'
const TURNS = ['#8B5CF6', '#F59E0B', '#EC4899', '#14B8A6', '#64748B', '#EF4444']

/** A decimal string as smallest units and decimals, for formatAmount. */
function units(decimal: string): { raw: string; decimals: number } {
  const [whole = '0', fraction = ''] = decimal.split('.')
  return { raw: `${whole}${fraction}`.replace(/^0+(?=\d)/, ''), decimals: fraction.length }
}

/** An exact decimal amount, cut to a few places for a cell, with dust shown as dust: "1,234.5678", "<0.0001". */
export function shortAmount(decimal: string, places = 4): string {
  const { raw, decimals } = units(decimal)
  const text = formatAmount(raw || '0', decimals, { maxFractionDigits: places })
  // formatAmount names dust down to its first digit; a cell only needs to say it's under the last place shown.
  return text.startsWith('<') ? `<0.${'0'.repeat(places - 1)}1` : text
}

const sum = (...amounts: string[]) => formatNear(amounts.reduce((total, amount) => total + (parseNear(amount) ?? 0n), 0n))

/** The Portfolio table's rows, from what main read: NEAR, staked NEAR, then each token on every chain read. */
export function portfolioView(portfolio: Portfolio): PortfolioView {
  const { near, nearPrice, tokens, unpriced, totalUsd } = portfolio
  const nearUsd = nearPrice?.usd ?? null
  const share = (counted: number) => (totalUsd && totalUsd > 0 ? counted / totalUsd : null)
  let turn = 0
  const colorOf = (symbol: string) => COLORS[symbol.toUpperCase()] ?? TURNS[turn++ % TURNS.length]!

  const nearRow = (id: string, symbol: string, label: string, amount: string, color: string): PortfolioRow => {
    const usd = nearUsd === null ? null : Number(amount) * nearUsd
    return { id, group: 'near', network: 'near', symbol, label, amount: shortAmount(amount), exact: amount, usd, counted: usd ?? 0, share: share(usd ?? 0), color, thin: false, contract: null }
  }
  const tokenRow = (token: TokenHolding): PortfolioRow => ({
    id: token.id,
    group: token.group,
    network: token.network,
    symbol: token.symbol,
    label: `${token.contract ? 'Token' : 'Native'} on ${token.networkName}`,
    amount: shortAmount(token.amount),
    exact: token.amount,
    usd: token.usdValue,
    counted: token.countedUsd,
    share: share(token.countedUsd),
    color: colorOf(token.symbol),
    thin: token.trust === 'reviewed' && token.countedUsd < token.usdValue * 0.95,
    contract: token.contract,
  })

  const held = sum(near.available, near.storage)
  const staked = sum(near.staked, ...near.pools.map((pool) => pool.unstaked))
  const rows = [
    nearRow('near', 'NEAR', 'Native on NEAR', held, COLORS.NEAR!),
    ...(staked !== '0' ? [nearRow('near-staked', 'NEAR', 'Staked on NEAR', staked, STAKED)] : []),
    ...tokens.filter((token) => token.trust === 'reviewed').map(tokenRow),
  ].sort((a, b) => b.counted - a.counted)
  return { rows, unreviewed: tokens.filter((token) => token.trust === 'unreviewed').map(tokenRow), unpriced, total: totalUsd }
}

/** The share bar: the biggest few, then the rest together. Rows under half a percent are left to "Other". */
export function shareBar(rows: readonly PortfolioRow[], max = 5): { label: string; share: number; color: string }[] {
  const shown = rows.filter((row) => row.share !== null && row.share >= 0.005).slice(0, max)
  const rest = rows.reduce((total, row) => total + (row.share ?? 0), 0) - shown.reduce((total, row) => total + (row.share ?? 0), 0)
  const bar = shown.map((row) => ({ label: row.id === 'near-staked' ? 'NEAR staked' : row.symbol, share: row.share ?? 0, color: row.color }))
  return rest >= 0.005 ? [...bar, { label: 'Other', share: rest, color: 'var(--ot-text-3)' }] : bar
}

/** "just now", "40 seconds ago", "3 minutes ago". */
export function readAgo(readAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - readAt) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.round(seconds / 60)
  return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`
}

/** Why there are no figures, in a line. */
export function portfolioFailure(result: Extract<PortfolioResult, { ok: false }>): string {
  if (result.reason === 'locked') return 'Ink locked while reading. Unlock it, then try again.'
  if (result.reason === 'no-vault') return 'There’s no wallet on this computer yet.'
  return 'Ink couldn’t reach NEAR to read your balances. Try again in a moment.'
}
