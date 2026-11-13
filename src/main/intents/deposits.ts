import { cleanSymbol, formatUnits } from '../../shared/token-text'
import type { IntentsDepositChain } from '../../shared/ipc'

/** The bridge behind NEAR Intents: deposit addresses and the tokens it takes. No key needed. */
export const BRIDGE_URL = 'https://bridge.chaindefuser.com/rpc'

/** The bridge's name for a chain: `eth:8453`, `sol:mainnet`. */
const CHAIN_KEY = /^[a-z]{2,12}:[0-9a-z]{1,16}$/

/**
 * Chains as people know them, in the order the Receive screen lists them, with Ink's
 * mark for each where it has one. A chain the bridge lists but this table doesn't is
 * left off the screen, not shown under a code name.
 */
const CHAINS: readonly { key: string; name: string; mark: string | null }[] = [
  { key: 'eth:1', name: 'Ethereum', mark: 'ethereum' },
  { key: 'eth:8453', name: 'Base', mark: 'base' },
  { key: 'eth:42161', name: 'Arbitrum', mark: 'arbitrum' },
  { key: 'eth:10', name: 'Optimism', mark: 'optimism' },
  { key: 'eth:137', name: 'Polygon', mark: 'polygon' },
  { key: 'eth:56', name: 'BNB Chain', mark: 'bsc' },
  { key: 'sol:mainnet', name: 'Solana', mark: 'solana' },
  { key: 'btc:mainnet', name: 'Bitcoin', mark: 'bitcoin' },
  { key: 'tron:mainnet', name: 'Tron', mark: 'tron' },
  { key: 'ton:mainnet', name: 'TON', mark: 'ton' },
  { key: 'xrp:mainnet', name: 'XRP Ledger', mark: 'xrp' },
  { key: 'sui:mainnet', name: 'Sui', mark: 'sui' },
  { key: 'aptos:mainnet', name: 'Aptos', mark: 'aptos' },
  { key: 'near:mainnet', name: 'NEAR', mark: 'near' },
  { key: 'eth:43114', name: 'Avalanche', mark: null },
  { key: 'eth:100', name: 'Gnosis', mark: null },
  { key: 'eth:80094', name: 'Berachain', mark: null },
  { key: 'eth:534352', name: 'Scroll', mark: null },
  { key: 'stellar:mainnet', name: 'Stellar', mark: null },
  { key: 'doge:mainnet', name: 'Dogecoin', mark: null },
  { key: 'ltc:mainnet', name: 'Litecoin', mark: null },
  { key: 'bch:mainnet', name: 'Bitcoin Cash', mark: null },
  { key: 'zec:mainnet', name: 'Zcash', mark: null },
  { key: 'cardano:mainnet', name: 'Cardano', mark: null },
  { key: 'starknet:mainnet', name: 'Starknet', mark: null },
]

const WHOLE = /^(0|[1-9][0-9]{0,77})$/

async function call(method: string, params: Record<string, unknown>, fetch: typeof globalThis.fetch, url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [params] }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`the bridge answered ${response.status}`)
  return response.json()
}

/**
 * The chains the bridge takes deposits on, each with its tokens and the least of each it
 * credits. Where the bridge lists one symbol twice on a chain, the higher minimum is
 * shown, so a deposit that meets it is credited either way. Null when the bridge can't
 * be read.
 */
export async function depositChains({ fetch = globalThis.fetch, url = BRIDGE_URL }: { fetch?: typeof globalThis.fetch; url?: string } = {}): Promise<IntentsDepositChain[] | null> {
  let body: unknown
  try {
    body = await call('supported_tokens', {}, fetch, url)
  } catch {
    return null
  }
  const tokens = (body as { result?: { tokens?: unknown } } | null)?.result?.tokens
  if (!Array.isArray(tokens)) return null
  const byChain = new Map<string, Map<string, { decimals: number; min: bigint }>>()
  for (const entry of tokens) {
    if (typeof entry !== 'object' || entry === null) continue
    const { defuse_asset_identifier: id, asset_name: name, decimals, min_deposit_amount: min } = entry as Record<string, unknown>
    const symbol = cleanSymbol(name)
    if (typeof id !== 'string' || !symbol || typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) continue
    if (typeof min !== 'string' || !WHOLE.test(min)) continue
    const key = id.split(':').slice(0, 2).join(':')
    if (!CHAIN_KEY.test(key)) continue
    const chain = byChain.get(key) ?? new Map()
    const known = chain.get(symbol)
    if (!known || BigInt(min) > known.min) chain.set(symbol, { decimals, min: BigInt(min) })
    byChain.set(key, chain)
  }
  return CHAINS.flatMap(({ key, name, mark }) => {
    const chain = byChain.get(key)
    if (!chain) return []
    const listed = [...chain].map(([symbol, { decimals, min }]) => ({ symbol, min: formatUnits(min, decimals) })).sort((a, b) => a.symbol.localeCompare(b.symbol))
    return [{ key, name, mark, tokens: listed }]
  })
}

/** Whether Ink lists a chain for deposits. */
export const isDepositChain = (key: string): boolean => CHAINS.some((chain) => chain.key === key)

/**
 * The account's deposit address on one chain: anything sent to it, the bridge credits to
 * the account's NEAR Intents balance. It's the bridge's address, stable for the account,
 * and not derived from the person's key. A chain that needs a memo (Stellar) gets one,
 * and the deposit isn't credited without it. Null when the bridge can't say.
 */
export async function depositAddress(accountId: string, chain: string, { fetch = globalThis.fetch, url = BRIDGE_URL }: { fetch?: typeof globalThis.fetch; url?: string } = {}): Promise<{ address: string; memo: string | null } | null> {
  if (!isDepositChain(chain)) return null
  const ask = async (memo: boolean) => {
    const body = (await call('deposit_address', { account_id: accountId, chain, ...(memo ? { deposit_mode: 'MEMO' } : {}) }, fetch, url)) as { result?: unknown; error?: unknown } | null
    return body ?? {}
  }
  try {
    let answer = await ask(false)
    // The bridge says when a chain needs the memo form, and refuses the plain one.
    if (typeof answer.error === 'string' && /memo/i.test(answer.error)) answer = await ask(true)
    const result = answer.result as { address?: unknown; chain?: unknown; memo?: unknown } | undefined
    if (!result || result.chain !== chain || typeof result.address !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(result.address)) return null
    if (result.memo !== undefined && (typeof result.memo !== 'string' || !/^[0-9A-Za-z]{1,64}$/.test(result.memo))) return null
    return { address: result.address, memo: typeof result.memo === 'string' ? result.memo : null }
  } catch {
    return null
  }
}
