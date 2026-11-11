import { cleanSymbol } from '../../shared/token-text'
import type { NearRpc } from '../near/rpc'

/** The NEAR Intents contract. It holds each account's Intents balance as NEP-245 tokens. */
export const INTENTS_CONTRACT = 'intents.near'

/** 1Click's list of the tokens Intents trades, with a price for each. No key needed. */
export const ONE_CLICK_TOKENS_URL = 'https://1click.chaindefuser.com/v0/tokens'

/** Tokens asked for in one view call. */
const PAGE = 100

/** Pages of tokens read, at most: more kinds of token than anyone holds on purpose. */
const MAX_PAGES = 5

/** An Intents token id: the standard, then the token. NFTs (nep171) aren't balances, so they're left out. */
const TOKEN_ID = /^nep(141|245):[A-Za-z0-9._:-]{1,200}$/

const WHOLE = /^(0|[1-9][0-9]*)$/

export interface IntentsBalance {
  /** As intents.near names it: `nep141:eth.omft.near`. */
  tokenId: string
  /** In the token's smallest unit. Never zero. */
  raw: bigint
}

/**
 * What the account holds in its Intents balance: every token intents.near lists for it,
 * with a balance above zero. Null when NEAR can't be read. The account's own NEAR
 * account id is its Intents account, so this needs no key and no service.
 */
export async function intentsBalances(accountId: string, { rpc }: { rpc: NearRpc }): Promise<IntentsBalance[] | null> {
  try {
    const ids: string[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const listed = await rpc.callView(INTENTS_CONTRACT, 'mt_tokens_for_owner', { account_id: accountId, from_index: String(page * PAGE), limit: PAGE })
      if (!Array.isArray(listed)) return null
      for (const entry of listed) {
        const id = typeof entry === 'object' && entry !== null ? (entry as { token_id?: unknown }).token_id : null
        if (typeof id === 'string' && TOKEN_ID.test(id) && !ids.includes(id)) ids.push(id)
      }
      if (listed.length < PAGE) break
    }
    const balances: IntentsBalance[] = []
    for (let start = 0; start < ids.length; start += PAGE) {
      const chunk = ids.slice(start, start + PAGE)
      const amounts = await rpc.callView(INTENTS_CONTRACT, 'mt_batch_balance_of', { account_id: accountId, token_ids: chunk })
      if (!Array.isArray(amounts) || amounts.length !== chunk.length) return null
      chunk.forEach((tokenId, i) => {
        const amount = amounts[i]
        if (typeof amount === 'string' && WHOLE.test(amount) && amount !== '0') balances.push({ tokenId, raw: BigInt(amount) })
      })
    }
    return balances
  } catch {
    return null
  }
}

export interface IntentsToken {
  symbol: string
  decimals: number
  /** Dollars per whole token, when 1Click has a price above zero. */
  usd: number | null
  /** The chain it came from, as a person reads it: "Base", "Bitcoin". */
  origin: string
}

/** 1Click's short names for chains, as people read them. Unknown ones are shown in capitals. */
const ORIGINS: Record<string, string> = {
  near: 'NEAR',
  eth: 'Ethereum',
  base: 'Base',
  arb: 'Arbitrum',
  op: 'Optimism',
  pol: 'Polygon',
  bsc: 'BNB Chain',
  avax: 'Avalanche',
  gnosis: 'Gnosis',
  bera: 'Berachain',
  sol: 'Solana',
  btc: 'Bitcoin',
  zec: 'Zcash',
  doge: 'Dogecoin',
  ltc: 'Litecoin',
  bch: 'Bitcoin Cash',
  dash: 'Dash',
  xrp: 'XRP',
  ton: 'TON',
  tron: 'Tron',
  sui: 'Sui',
  aptos: 'Aptos',
  stellar: 'Stellar',
  cardano: 'Cardano',
  starknet: 'Starknet',
  scroll: 'Scroll',
  monad: 'Monad',
  plasma: 'Plasma',
  abs: 'Abstract',
  hood: 'Robinhood Chain',
  xlayer: 'X Layer',
}

export function originName(code: string): string {
  return ORIGINS[code] ?? code.toUpperCase()
}

/**
 * Every token 1Click lists, by its Intents token id, with a symbol fit to show. A
 * symbol's "(DEPRECATED)" or "(OMNI)" tag is dropped; one that still isn't a single
 * short word leaves the token out. Null when 1Click can't be reached.
 */
export async function intentsTokenList({ fetch = globalThis.fetch, url = ONE_CLICK_TOKENS_URL }: { fetch?: typeof globalThis.fetch; url?: string } = {}): Promise<Map<string, IntentsToken> | null> {
  let body: unknown
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return null
    body = await response.json()
  } catch {
    return null
  }
  if (!Array.isArray(body)) return null
  const tokens = new Map<string, IntentsToken>()
  for (const entry of body) {
    if (typeof entry !== 'object' || entry === null) continue
    const { assetId, symbol, decimals, price, blockchain } = entry as Record<string, unknown>
    const clean = cleanSymbol(typeof symbol === 'string' ? symbol.replace(/\([A-Z]+\)$/, '') : null)
    if (typeof assetId !== 'string' || !TOKEN_ID.test(assetId) || !clean) continue
    if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) continue
    const usd = typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null
    tokens.set(assetId, { symbol: clean, decimals, usd, origin: originName(typeof blockchain === 'string' ? blockchain : '?') })
  }
  return tokens
}
