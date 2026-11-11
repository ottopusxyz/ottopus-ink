/** What the wallet holds, as main reads it from each chain. Amounts are decimal strings in the chain's own unit. */

export interface NearPoolHolding {
  poolId: string
  staked: string
  /** Unstaked but still in the pool, waiting to be withdrawn. */
  unstaked: string
}

export interface NearHolding {
  accountId: string
  /** False until something is sent to the account: NEAR creates an implicit account with its first incoming transfer. */
  onChain: boolean
  /** What can be sent now, in NEAR. */
  available: string
  staked: string
  /** Held back to pay for the account's storage, in NEAR. */
  storage: string
  pools: NearPoolHolding[]
  /** False when a pool, or the list of pools, couldn't be read, so staked may be low. */
  stakingComplete: boolean
}

export interface Price {
  /** Dollars per whole coin or token. */
  usd: number
  /** How it moved over the last day, as a fraction: 0.05 is up 5%. */
  change24h: number | null
}

/**
 * A token the wallet holds, with a price. `reviewed` is counted in the total: the price
 * service vouches for it. `unreviewed` has a price but nobody vouches for it, and anyone
 * can make a pool and so a price, so it is shown apart and never counted.
 */
export interface TokenHolding {
  chain: 'near'
  /** The token's contract account. */
  contract: string
  /** One short word, checked: a token's own symbol can be any text its maker likes. */
  symbol: string
  decimals: number
  /** Exact, in whole tokens. */
  amount: string
  price: Price
  /** At the market price. */
  usdValue: number
  /**
   * What it adds to the total. Nothing for an unreviewed token. For a reviewed one, the
   * market value, or less when its market is too thin to sell this much near the price.
   */
  countedUsd: number
  trust: 'reviewed' | 'unreviewed'
}

/** What couldn't be read this time, so the figures may be short: `tokens` (the token list), `prices`, or `reviews` (which tokens are vouched for). */
export type PortfolioGap = 'tokens' | 'prices' | 'reviews'

export interface Portfolio {
  near: NearHolding
  /** NEAR's own price, when the price service answered. */
  nearPrice: Price | null
  /** Most valuable first. */
  tokens: TokenHolding[]
  /** Tokens held with no price, or that the price service marks as spam. Counted only, never named. */
  unpriced: number
  /** NEAR, staked and held for storage included, plus every reviewed token. Null without NEAR's price. */
  totalUsd: number | null
  /** When the figures were read, ms since the epoch. */
  readAt: number
  gaps: PortfolioGap[]
}

export type PortfolioResult = ({ ok: true } & Portfolio) | { ok: false; reason: 'locked' | 'no-vault' | 'unavailable' }
