import { formatNear, YOCTO_DECIMALS } from '../../shared/near/units'
import type { HoldingGroup, Portfolio, PortfolioGap, Price, TokenHolding, ZerionState } from '../../shared/portfolio'
import { formatUnits, usdValue } from '../../shared/token-text'
import { nearBalance, type NearBalance } from '../near/balance'
import type { NearRpc } from '../near/rpc'
import { nearPriceList, nearTokenReview, WRAPPED_NEAR, type NearTokenPrice, type NearTokenReview } from './near-prices'
import { nearTokenBalances, type NearTokenBalance } from './near-tokens'
import { ZerionError, zerionHoldings, type ZerionHolding } from './zerion'

/** How long a read stands. Opening the screen again inside this shows the same figures. */
export const PORTFOLIO_TTL_MS = 60_000

/** How long what the price service says of a token stands. Reputations change rarely. */
export const REVIEW_TTL_MS = 60 * 60_000

/** Tokens looked up one by one, most valuable first. The rest go unreviewed rather than costing a call each. */
export const MAX_REVIEWS = 25

type Fetch = typeof globalThis.fetch

export interface PortfolioReaderOptions {
  rpc: NearRpc
  /** The person's Zerion key, read each time so a new one counts at once. Null without one. */
  zerionKey?: () => string | null
  fetch?: Fetch
  now?: () => number
}

/** The wallet's public addresses the portfolio is read for. NEAR always; the rest when the wallet has them. */
export interface PortfolioAccounts {
  near: string
  evm?: string | undefined
  solana?: string | undefined
  tron?: string | undefined
}

export interface PortfolioReader {
  /** The wallet's portfolio. `fresh` reads again instead of taking a recent read, but still shares one already under way. */
  read(accounts: PortfolioAccounts, options?: { fresh?: boolean }): Promise<Portfolio>
  /** Drops every kept read, as when the Zerion key changes. */
  forget(): void
}

const ZERION_GROUPS = ['evm', 'solana', 'tron'] as const satisfies readonly HoldingGroup[]

/** A Zerion holding in the portfolio's terms. Zerion's own list of known tokens decides what's counted; its spam filter has already run. */
function fromZerion(holding: ZerionHolding): TokenHolding | null {
  if (holding.usdValue === null || holding.usdPrice === null) return null
  return {
    id: `${holding.network}:${holding.contract ?? 'native'}`,
    group: holding.group,
    network: holding.network,
    networkName: holding.networkName,
    contract: holding.contract,
    symbol: holding.symbol,
    decimals: holding.decimals,
    amount: formatUnits(holding.raw, holding.decimals),
    price: { usd: holding.usdPrice, change24h: holding.change24h },
    usdValue: holding.usdValue,
    countedUsd: holding.verified ? holding.usdValue : 0,
    trust: holding.verified ? 'reviewed' : 'unreviewed',
  }
}

/**
 * What selling `value` dollars of a token into pools holding `liquidity` dollars would
 * roughly fetch. In a constant-product pool with Q dollars of the other side, selling V
 * at the price returns V·Q / (Q + V). Under 5% short of the price, it counts at the price,
 * so an ordinary holding adds up to exactly what its row says. Without a liquidity figure
 * it counts at the price, as most reviewed tokens are deep.
 */
export function saleValue(value: number, liquidity: number | null): number {
  if (liquidity === null) return value
  const other = liquidity / 2
  const fetched = (value * other) / (other + value)
  return fetched >= value * 0.95 ? value : fetched
}

const VOUCHED = new Set<NearTokenReview['reputation']>(['reputable', 'not-fake'])

/** Everything the account holds in NEAR, in yoctoNEAR: what it can send, what storage holds, and every stake, waiting withdrawals included. */
function nearTotal(balance: NearBalance): bigint {
  return balance.available + balance.storage + balance.staked + balance.pools.reduce((sum, pool) => sum + pool.unstaked, 0n)
}

/**
 * The wallet's portfolio: its NEAR, every NEAR token with a price, what Zerion reads for
 * the EVM, Solana and Tron accounts when the person gave Ink a key, and what that comes to.
 * Each source can fail on its own. Without NEAR itself there is nothing to show, so that
 * throws; without the rest the portfolio says what is missing.
 */
export function createPortfolioReader({ rpc, zerionKey = () => null, fetch = globalThis.fetch, now = Date.now }: PortfolioReaderOptions): PortfolioReader {
  const reads = new Map<string, { at: number; read: Promise<Portfolio> }>()
  const reviews = new Map<string, { at: number; review: NearTokenReview }>()

  async function reviewOf(contract: string): Promise<NearTokenReview | null> {
    const kept = reviews.get(contract)
    if (kept && now() - kept.at < REVIEW_TTL_MS) return kept.review
    const review = await nearTokenReview(contract, { fetch })
    if (review) reviews.set(contract, { at: now(), review })
    return review
  }

  /** Each account Zerion reads, side by side. One that fails says why; the rest still count. */
  async function readZerion(accounts: PortfolioAccounts): Promise<{ state: ZerionState; holdings: ZerionHolding[]; unread: HoldingGroup[] }> {
    const key = zerionKey()
    if (!key) return { state: 'off', holdings: [], unread: [] }
    const asked = ZERION_GROUPS.filter((group) => accounts[group])
    const results = await Promise.all(
      asked.map((group) =>
        zerionHoldings(accounts[group] as string, { key, fetch }).then(
          (holdings) => ({ group, holdings, failure: null }),
          (error: unknown) => ({ group, holdings: [], failure: error instanceof ZerionError ? error.reason : ('unavailable' as const) }),
        ),
      ),
    )
    const failures = results.map((result) => result.failure)
    // A refused key or a spent quota is the whole of Zerion; an address it doesn't track is only that account.
    const state: ZerionState = failures.includes('bad-key') ? 'bad-key' : failures.includes('rate-limited') ? 'rate-limited' : failures.length > 0 && failures.every((failure) => failure === 'unavailable') ? 'unavailable' : 'ok'
    return {
      state,
      // Each account answers only for its own kind of chain, so one address can't fill in for another.
      holdings: results.flatMap((result) => result.holdings.filter((holding) => holding.group === result.group)),
      unread: results.filter((result) => result.failure !== null).map((result) => result.group),
    }
  }

  async function read(accounts: PortfolioAccounts): Promise<Portfolio> {
    const accountId = accounts.near
    const [balance, held, prices, zerion] = await Promise.all([nearBalance(accountId, { rpc, fetch }), nearTokenBalances(accountId, { fetch }), nearPriceList({ fetch }), readZerion(accounts)])
    const gaps: PortfolioGap[] = []
    if (held === null) gaps.push('tokens')
    if (prices === null) gaps.push('prices')

    const priced: { token: NearTokenBalance; price: NearTokenPrice; value: number }[] = []
    let unpriced = 0
    for (const token of held ?? []) {
      const price = prices?.get(token.contract)
      if (price) priced.push({ token, price, value: usdValue(token.raw, price.decimals, price.usd) })
      else unpriced++
    }
    priced.sort((a, b) => b.value - a.value)

    const nearUsd = prices?.get(WRAPPED_NEAR)?.usd ?? null
    const asked = priced.slice(0, MAX_REVIEWS).map(({ token }) => token.contract)
    const looked = await Promise.all([nearUsd !== null ? reviewOf(WRAPPED_NEAR) : null, ...asked.map(reviewOf)])
    const [nearReview, ...found] = looked
    if (found.some((review) => review === null)) gaps.push('reviews')
    const reviewed = new Map(asked.map((contract, i) => [contract, found[i] ?? null]))

    const tokens: TokenHolding[] = []
    for (const { token, price, value } of priced) {
      const review = reviewed.get(token.contract) ?? null
      if (review?.reputation === 'spam') {
        unpriced++
        continue
      }
      const vouched = review !== null && VOUCHED.has(review.reputation)
      tokens.push({
        id: `near:${token.contract}`,
        group: 'near',
        network: 'near',
        networkName: 'NEAR',
        contract: token.contract,
        symbol: price.symbol,
        decimals: price.decimals,
        amount: formatUnits(token.raw, price.decimals),
        price: { usd: price.usd, change24h: review?.change24h ?? null },
        usdValue: value,
        countedUsd: vouched ? saleValue(value, review.liquidityUsd) : 0,
        trust: vouched ? 'reviewed' : 'unreviewed',
      })
    }

    for (const holding of zerion.holdings) {
      const token = fromZerion(holding)
      if (token) tokens.push(token)
      else unpriced++
    }
    tokens.sort((a, b) => b.usdValue - a.usdValue)

    const nearPrice: Price | null = nearUsd === null ? null : { usd: nearUsd, change24h: nearReview?.change24h ?? null }
    const counted = tokens.reduce((sum, token) => sum + token.countedUsd, 0)
    return {
      near: {
        accountId,
        onChain: balance.onChain,
        available: formatNear(balance.available),
        staked: formatNear(balance.staked),
        storage: formatNear(balance.storage),
        pools: balance.pools.map(({ poolId, staked, unstaked }) => ({ poolId, staked: formatNear(staked), unstaked: formatNear(unstaked) })),
        stakingComplete: balance.stakingComplete,
      },
      nearPrice,
      tokens,
      zerion: zerion.state,
      unread: zerion.state === 'ok' ? zerion.unread : [],
      unpriced,
      totalUsd: nearPrice === null ? null : usdValue(nearTotal(balance), YOCTO_DECIMALS, nearPrice.usd) + counted,
      readAt: now(),
      gaps,
    }
  }

  return {
    read(accounts, { fresh = false } = {}) {
      // Kept by the addresses read and whether a key was there, so adding a key reads again.
      const key = JSON.stringify([accounts.near, accounts.evm, accounts.solana, accounts.tron, zerionKey() !== null])
      const kept = reads.get(key)
      // A read under way has no time yet; a finished one stands for the TTL unless asked fresh.
      if (kept && (kept.at === -1 || (!fresh && now() - kept.at < PORTFOLIO_TTL_MS))) return kept.read
      const entry = { at: -1, read: read(accounts) }
      reads.set(key, entry)
      entry.read.then(
        () => (entry.at = now()),
        () => {
          if (reads.get(key) === entry) reads.delete(key)
        },
      )
      return entry.read
    },
    forget() {
      reads.clear()
    },
  }
}
