import type { IntentsDepositChain } from '../../shared/ipc'
import { formatUnits } from '../../shared/token-text'
import { ONE_CLICK_URL, oneClickTokens } from '../routes/one-click'

/**
 * Deposits into the NEAR Intents balance, through 1Click. NEAR Intents closed the bridge
 * API Ink used for this on 11 November 2026 (it answers every call with 403 since the
 * 17th), and points to 1Click instead: its token list for what it takes, and a quote
 * from a token on its own chain into the same token in the account's Intents balance for
 * an address to send it to. A quote needs no key.
 */

/**
 * Chains as people know them, in the order the Receive screen lists them, with Ink's
 * mark for each where it has one. `key` is Ink's own name for the chain (the bridge's
 * old names, which Ink keeps and has saved), `oneClick` 1Click's. A chain 1Click lists
 * but this table doesn't is left off the screen, not shown under a code name.
 */
const CHAINS: readonly { key: string; oneClick: string; name: string; mark: string | null }[] = [
  { key: 'eth:1', oneClick: 'eth', name: 'Ethereum', mark: 'ethereum' },
  { key: 'eth:8453', oneClick: 'base', name: 'Base', mark: 'base' },
  { key: 'eth:42161', oneClick: 'arb', name: 'Arbitrum', mark: 'arbitrum' },
  { key: 'eth:10', oneClick: 'op', name: 'Optimism', mark: 'optimism' },
  { key: 'eth:137', oneClick: 'pol', name: 'Polygon', mark: 'polygon' },
  { key: 'eth:56', oneClick: 'bsc', name: 'BNB Chain', mark: 'bsc' },
  { key: 'sol:mainnet', oneClick: 'sol', name: 'Solana', mark: 'solana' },
  { key: 'btc:mainnet', oneClick: 'btc', name: 'Bitcoin', mark: 'bitcoin' },
  { key: 'tron:mainnet', oneClick: 'tron', name: 'Tron', mark: 'tron' },
  { key: 'ton:mainnet', oneClick: 'ton', name: 'TON', mark: 'ton' },
  { key: 'xrp:mainnet', oneClick: 'xrp', name: 'XRP Ledger', mark: 'xrp' },
  { key: 'sui:mainnet', oneClick: 'sui', name: 'Sui', mark: 'sui' },
  { key: 'aptos:mainnet', oneClick: 'aptos', name: 'Aptos', mark: 'aptos' },
  { key: 'near:mainnet', oneClick: 'near', name: 'NEAR', mark: 'near' },
  { key: 'eth:43114', oneClick: 'avax', name: 'Avalanche', mark: null },
  { key: 'eth:100', oneClick: 'gnosis', name: 'Gnosis', mark: null },
  { key: 'eth:80094', oneClick: 'bera', name: 'Berachain', mark: null },
  { key: 'eth:534352', oneClick: 'scroll', name: 'Scroll', mark: null },
  { key: 'stellar:mainnet', oneClick: 'stellar', name: 'Stellar', mark: null },
  { key: 'doge:mainnet', oneClick: 'doge', name: 'Dogecoin', mark: null },
  { key: 'ltc:mainnet', oneClick: 'ltc', name: 'Litecoin', mark: null },
  { key: 'bch:mainnet', oneClick: 'bch', name: 'Bitcoin Cash', mark: null },
  { key: 'zec:mainnet', oneClick: 'zec', name: 'Zcash', mark: null },
  { key: 'cardano:mainnet', oneClick: 'cardano', name: 'Cardano', mark: null },
  { key: 'starknet:mainnet', oneClick: 'starknet', name: 'Starknet', mark: null },
]

const WHOLE = /^(0|[1-9][0-9]{0,77})$/

/** How long Ink asks 1Click to keep a deposit address open. 1Click keeps it a few days more. */
const ADDRESS_DAYS = 3

/**
 * The chains NEAR Intents takes deposits on, each with its tokens. The least of each it
 * credits isn't in 1Click's list: it comes with each address. A symbol listed twice on a
 * chain keeps its first listing for deposits, and both ids. Null when 1Click can't be read.
 */
export async function depositChains({ fetch = globalThis.fetch, url = ONE_CLICK_URL }: { fetch?: typeof globalThis.fetch; url?: string } = {}): Promise<IntentsDepositChain[] | null> {
  const tokens = await oneClickTokens({ fetch, url })
  if (!tokens) return null
  return CHAINS.flatMap(({ key, oneClick, name, mark }) => {
    const bySymbol = new Map<string, { symbol: string; min: null; ids: string[]; decimals: number }>()
    for (const token of tokens) {
      if (token.blockchain !== oneClick) continue
      const known = bySymbol.get(token.symbol)
      if (known) known.ids.push(token.assetId)
      else bySymbol.set(token.symbol, { symbol: token.symbol, min: null, ids: [token.assetId], decimals: token.decimals })
    }
    if (bySymbol.size === 0) return []
    return [{ key, name, mark, tokens: [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)) }]
  })
}

/** A deposit address 1Click gave for one token, into one account's NEAR Intents balance. */
export interface DepositAddress {
  address: string
  /** Required with the deposit on a chain that needs one (Stellar), or null. */
  memo: string | null
  /** The least 1Click credits, in whole tokens, or null when it takes any amount. */
  min: string | null
  /** When 1Click stops watching the address, in ms since the epoch. Nothing should be sent after. */
  until: number
}

/**
 * A deposit address for one token: anything of it sent there, 1Click credits to the
 * account's NEAR Intents balance, the same token, and refunds into that balance too. It's
 * 1Click's address, not derived from the person's key, and it's open for a few days only.
 * Asked with no amount, so any amount from its minimum on is credited. A chain that needs a
 * memo (Stellar) gets one, and the deposit isn't credited without it. Null when 1Click
 * can't say, or answers for anything but what was asked.
 */
export async function depositAddress(
  accountId: string,
  token: { id: string; decimals: number },
  { fetch = globalThis.fetch, url = ONE_CLICK_URL, now = Date.now }: { fetch?: typeof globalThis.fetch; url?: string; now?: () => number } = {},
): Promise<DepositAddress | null> {
  const sent = {
    dry: false,
    swapType: 'FLEX_INPUT',
    slippageTolerance: 100,
    originAsset: token.id,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: token.id,
    amount: '0',
    refundTo: accountId,
    refundType: 'INTENTS',
    recipient: accountId,
    recipientType: 'INTENTS',
    deadline: new Date(now() + ADDRESS_DAYS * 24 * 60 * 60_000).toISOString(),
  }
  const ask = async (memo: boolean): Promise<{ ok: boolean; body: Record<string, unknown> }> => {
    const response = await fetch(`${url}/v0/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(memo ? { ...sent, depositMode: 'MEMO' } : sent),
      signal: AbortSignal.timeout(20_000),
    })
    const body = (await response.json()) as unknown
    return { ok: response.ok, body: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {} }
  }
  try {
    let answer = await ask(false)
    // 1Click says when a chain needs the memo form, and refuses the plain one.
    if (!answer.ok && typeof answer.body.message === 'string' && /depositMode|memo/i.test(answer.body.message)) answer = await ask(true)
    if (!answer.ok) return null
    const echoed = answer.body.quoteRequest as Record<string, unknown> | undefined
    const quote = answer.body.quote as Record<string, unknown> | undefined
    if (!echoed || !quote) return null
    const same = ['swapType', 'originAsset', 'destinationAsset', 'depositType', 'refundTo', 'refundType', 'recipient', 'recipientType'] as const
    if (same.some((key) => echoed[key] !== sent[key])) return null
    const { depositAddress: address, depositMemo: memo, minAmountIn: min } = quote
    if (typeof address !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(address)) return null
    if (memo !== undefined && memo !== null && (typeof memo !== 'string' || !/^[0-9A-Za-z]{1,64}$/.test(memo))) return null
    const until = Date.parse(String(quote.timeWhenInactive ?? quote.deadline))
    if (!Number.isFinite(until) || until <= now()) return null
    const least = typeof min === 'string' && WHOLE.test(min) && min !== '0' ? formatUnits(BigInt(min), token.decimals) : null
    return { address, memo: typeof memo === 'string' ? memo : null, min: least, until }
  } catch {
    return null
  }
}
