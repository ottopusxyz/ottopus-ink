import { isNearAccountId } from '../../shared/near/account-id'
import type { NearAccountView, NearRpc } from './rpc'

/** What NEAR holds back for each byte an account stores: 10^19 yoctoNEAR, so 100 kB is 1 NEAR. */
export const STORAGE_YOCTO_PER_BYTE = 10n ** 19n

/** FastNEAR's index of which pools an account has staked with. Only a hint: each balance is read from the pool itself. */
export const STAKING_INDEX_URL = 'https://api.fastnear.com/v1/account'

/** More pools than anyone uses; the rest are skipped rather than asked one by one. */
const MAX_POOLS = 20

export interface NearPoolStake {
  poolId: string
  /** Earning rewards, yoctoNEAR. */
  staked: bigint
  /** Unstaked but still in the pool, waiting to be withdrawn. yoctoNEAR. */
  unstaked: bigint
}

export interface NearBalance {
  accountId: string
  /** False for an implicit account nothing was sent to yet: NEAR creates it with its first incoming transfer. */
  onChain: boolean
  /** What can be sent now, yoctoNEAR: the liquid balance less what storage holds back. */
  available: bigint
  /** Held back to pay for the account's storage, yoctoNEAR. */
  storage: bigint
  /** Staked with pools, and the account's own validator stake if it has one. yoctoNEAR. */
  staked: bigint
  pools: NearPoolStake[]
  /** False when some pool couldn't be read, or the index of pools couldn't be reached: staked may be low. */
  stakingComplete: boolean
}

type Fetch = typeof globalThis.fetch

export interface NearBalanceOptions {
  rpc: NearRpc
  fetch?: Fetch
  indexUrl?: string
}

const WHOLE = /^(0|[1-9][0-9]*)$/

/** The pools FastNEAR says the account staked with, or null when it can't say. */
async function poolsOf(accountId: string, fetch: Fetch, indexUrl: string): Promise<string[] | null> {
  try {
    const response = await fetch(`${indexUrl}/${encodeURIComponent(accountId)}/staking`, { signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return null
    const body = (await response.json()) as { pools?: unknown }
    if (!Array.isArray(body.pools)) return null
    const ids = body.pools.map((pool) => (typeof pool === 'object' && pool !== null ? (pool as { pool_id?: unknown }).pool_id : null))
    return [...new Set(ids.filter((id): id is string => typeof id === 'string' && isNearAccountId(id)))]
  } catch {
    return null
  }
}

async function poolStake(rpc: NearRpc, poolId: string, accountId: string): Promise<NearPoolStake | null> {
  try {
    const [staked, unstaked] = await Promise.all([
      rpc.callView(poolId, 'get_account_staked_balance', { account_id: accountId }),
      rpc.callView(poolId, 'get_account_unstaked_balance', { account_id: accountId }),
    ])
    if (typeof staked !== 'string' || typeof unstaked !== 'string' || !WHOLE.test(staked) || !WHOLE.test(unstaked)) return null
    return { poolId, staked: BigInt(staked), unstaked: BigInt(unstaked) }
  } catch {
    return null
  }
}

/** What storage holds back from the liquid balance: paid from a validator stake first, and never more than the balance. */
export function storageHeld({ amount, locked, storageUsage }: NearAccountView): bigint {
  const cost = storageUsage * STORAGE_YOCTO_PER_BYTE
  const fromLiquid = cost > locked ? cost - locked : 0n
  return fromLiquid < amount ? fromLiquid : amount
}

/** The NEAR account's balance: what can be sent, what storage holds back, and what's staked where. */
export async function nearBalance(accountId: string, { rpc, fetch = globalThis.fetch, indexUrl = STAKING_INDEX_URL }: NearBalanceOptions): Promise<NearBalance> {
  const view = await rpc.viewAccount(accountId)
  if (!view) return { accountId, onChain: false, available: 0n, storage: 0n, staked: 0n, pools: [], stakingComplete: true }

  const storage = storageHeld(view)

  const poolIds = await poolsOf(accountId, fetch, indexUrl)
  const asked = (poolIds ?? []).slice(0, MAX_POOLS)
  const stakes = await Promise.all(asked.map((poolId) => poolStake(rpc, poolId, accountId)))
  const pools = stakes.filter((stake): stake is NearPoolStake => stake !== null && (stake.staked > 0n || stake.unstaked > 0n))
  const stakingComplete = poolIds !== null && poolIds.length <= MAX_POOLS && stakes.every((stake) => stake !== null)

  return {
    accountId,
    onChain: true,
    available: view.amount - storage,
    storage,
    staked: view.locked + pools.reduce((sum, pool) => sum + pool.staked, 0n),
    pools,
    stakingComplete,
  }
}
