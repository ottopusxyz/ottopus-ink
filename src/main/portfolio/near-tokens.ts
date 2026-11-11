import { isNearAccountId } from '../../shared/near/account-id'

/** FastNEAR's index of which NEP-141 tokens an account holds, and how much of each. No key needed. */
export const TOKEN_INDEX_URL = 'https://api.fastnear.com/v1/account'

/** More tokens than anyone holds on purpose. Past this the rest are airdrops, and they aren't read. */
export const MAX_TOKENS = 500

const WHOLE = /^(0|[1-9][0-9]*)$/

export interface NearTokenBalance {
  /** The token's contract account. */
  contract: string
  /** In the token's smallest unit. Never zero. */
  raw: bigint
}

type Fetch = typeof globalThis.fetch

/**
 * Every NEP-141 token the account holds, as FastNEAR indexes it, or null when the
 * index can't be reached or answers with something else. Zero balances, and any
 * entry that isn't a real account and a whole number, are left out. Anyone can send
 * an account a token, so what comes back is only a list to look prices up for.
 */
export async function nearTokenBalances(accountId: string, { fetch = globalThis.fetch, indexUrl = TOKEN_INDEX_URL }: { fetch?: Fetch; indexUrl?: string } = {}): Promise<NearTokenBalance[] | null> {
  let body: unknown
  try {
    const response = await fetch(`${indexUrl}/${encodeURIComponent(accountId)}/ft`, { signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return null
    body = await response.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { tokens?: unknown }).tokens)) return null

  const seen = new Map<string, bigint>()
  for (const entry of (body as { tokens: unknown[] }).tokens) {
    if (typeof entry !== 'object' || entry === null) continue
    const { contract_id: contract, balance } = entry as { contract_id?: unknown; balance?: unknown }
    if (typeof contract !== 'string' || !isNearAccountId(contract)) continue
    if (typeof balance !== 'string' || !WHOLE.test(balance) || balance === '0') continue
    if (seen.has(contract)) continue
    seen.set(contract, BigInt(balance))
    if (seen.size >= MAX_TOKENS) break
  }
  return [...seen].map(([contract, raw]) => ({ contract, raw }))
}
