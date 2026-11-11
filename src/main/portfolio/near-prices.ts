import { cleanSymbol } from '../../shared/token-text'

/**
 * Intear's price service for NEAR tokens: a price for every token with a pool, and a
 * reputation for each, from its own review. No key needed.
 */
export const PRICE_URL = 'https://prices.intear.tech'

/** The token NEAR's own price is quoted as. */
export const WRAPPED_NEAR = 'wrap.near'

export interface NearTokenPrice {
  symbol: string
  decimals: number
  /** Dollars per whole token. Always above zero. */
  usd: number
}

/**
 * - `reputable`, `not-fake`: Intear reviewed it. Counted in a total.
 * - `unknown`: nobody has. Shown, never counted: anyone can make a pool and so a price.
 * - `spam`: Intear marked it as a scam.
 */
export type TokenReputation = 'reputable' | 'not-fake' | 'unknown' | 'spam'

export interface NearTokenReview {
  reputation: TokenReputation
  /** How the price moved over the last day, as a fraction: 0.05 is up 5%. Null when Intear has no price from a day ago. */
  change24h: number | null
}

type Fetch = typeof globalThis.fetch

interface Options {
  fetch?: Fetch
  url?: string
}

async function getJson(url: string, fetch: Fetch, timeoutMs: number): Promise<unknown> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok ? ((await response.json()) as unknown) : null
  } catch {
    return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function positive(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Every token Intear prices above zero, by contract, with a symbol fit to show. A token
 * whose symbol isn't one word, or whose decimals make no sense, is left out, so it can
 * only ever show up as one of the unpriced. Null when Intear can't be reached.
 */
export async function nearPriceList({ fetch = globalThis.fetch, url = PRICE_URL }: Options = {}): Promise<Map<string, NearTokenPrice> | null> {
  const body = await getJson(`${url}/list-token-price`, fetch, 10_000)
  if (!isRecord(body)) return null
  const prices = new Map<string, NearTokenPrice>()
  for (const [contract, entry] of Object.entries(body)) {
    if (!isRecord(entry)) continue
    const usd = positive(entry.price)
    const symbol = cleanSymbol(entry.symbol)
    const decimals = entry.decimal
    if (usd === null || symbol === null || typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) continue
    prices.set(contract, { symbol, decimals, usd })
  }
  return prices
}

const REPUTATIONS: Record<string, TokenReputation> = { Reputable: 'reputable', NotFake: 'not-fake', Unknown: 'unknown', Spam: 'spam' }

/** What Intear says of one token, or null when it can't say. An answer Ink doesn't know reads as unknown. */
export async function nearTokenReview(contract: string, { fetch = globalThis.fetch, url = PRICE_URL }: Options = {}): Promise<NearTokenReview | null> {
  const body = await getJson(`${url}/token?token_id=${encodeURIComponent(contract)}`, fetch, 8_000)
  if (!isRecord(body) || body.account_id !== contract) return null
  const reputation = typeof body.reputation === 'string' ? (REPUTATIONS[body.reputation] ?? 'unknown') : 'unknown'
  // Intear gives the day-old price only in its raw unit, so the change is taken between two raw prices.
  const now = positive(body.price_usd_raw)
  const before = positive(body.price_usd_raw_24h_ago)
  return { reputation, change24h: now !== null && before !== null ? now / before - 1 : null }
}
