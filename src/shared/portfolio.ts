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

export type PortfolioResult = { ok: true; near: NearHolding } | { ok: false; reason: 'locked' | 'no-vault' | 'unavailable' }
