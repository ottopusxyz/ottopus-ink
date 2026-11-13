import type { Account, AccountChain } from '../../shared/accounts'
import type { IntentsDepositChain, ReceiveAnswer, ReceiveChain, ReceiveToken } from '../../shared/ipc'
import { parseUnits } from '../../shared/token-text'

/**
 * Every chain the Receive screen and the agent can name, joining the wallet's own chains
 * with those NEAR Intents takes deposits on. `own` is the wallet account that receives
 * there, `bridge` the NEAR Intents bridge's name for it, and `zerion` Zerion's, for token
 * search. The first five are the ones shown before any search.
 */
const CHAINS: readonly { id: string; name: string; mark: string | null; own: AccountChain | null; bridge: string | null; zerion: string | null; coin: string }[] = [
  { id: 'near', name: 'NEAR', mark: 'near', own: 'near', bridge: 'near:mainnet', zerion: null, coin: 'NEAR' },
  { id: 'base', name: 'Base', mark: 'base', own: 'evm', bridge: 'eth:8453', zerion: 'base', coin: 'ETH' },
  { id: 'ethereum', name: 'Ethereum', mark: 'ethereum', own: 'evm', bridge: 'eth:1', zerion: 'ethereum', coin: 'ETH' },
  { id: 'solana', name: 'Solana', mark: 'solana', own: 'solana', bridge: 'sol:mainnet', zerion: 'solana', coin: 'SOL' },
  { id: 'bitcoin', name: 'Bitcoin', mark: 'bitcoin', own: 'bitcoin', bridge: 'btc:mainnet', zerion: null, coin: 'BTC' },
  { id: 'arbitrum', name: 'Arbitrum', mark: 'arbitrum', own: 'evm', bridge: 'eth:42161', zerion: 'arbitrum', coin: 'ETH' },
  { id: 'optimism', name: 'Optimism', mark: 'optimism', own: 'evm', bridge: 'eth:10', zerion: 'optimism', coin: 'ETH' },
  { id: 'polygon', name: 'Polygon', mark: 'polygon', own: 'evm', bridge: 'eth:137', zerion: 'polygon', coin: 'POL' },
  { id: 'bsc', name: 'BNB Chain', mark: 'bsc', own: 'evm', bridge: 'eth:56', zerion: 'binance-smart-chain', coin: 'BNB' },
  { id: 'avalanche', name: 'Avalanche', mark: null, own: 'evm', bridge: 'eth:43114', zerion: 'avalanche', coin: 'AVAX' },
  { id: 'gnosis', name: 'Gnosis', mark: null, own: 'evm', bridge: 'eth:100', zerion: 'xdai', coin: 'xDAI' },
  { id: 'berachain', name: 'Berachain', mark: null, own: 'evm', bridge: 'eth:80094', zerion: 'berachain', coin: 'BERA' },
  { id: 'scroll', name: 'Scroll', mark: null, own: 'evm', bridge: 'eth:534352', zerion: 'scroll', coin: 'ETH' },
  { id: 'tron', name: 'Tron', mark: 'tron', own: 'tron', bridge: 'tron:mainnet', zerion: null, coin: 'TRX' },
  { id: 'sui', name: 'Sui', mark: 'sui', own: 'sui', bridge: 'sui:mainnet', zerion: null, coin: 'SUI' },
  { id: 'aptos', name: 'Aptos', mark: 'aptos', own: 'aptos', bridge: 'aptos:mainnet', zerion: null, coin: 'APT' },
  { id: 'ton', name: 'TON', mark: 'ton', own: null, bridge: 'ton:mainnet', zerion: null, coin: 'TON' },
  { id: 'xrp', name: 'XRP Ledger', mark: 'xrp', own: null, bridge: 'xrp:mainnet', zerion: null, coin: 'XRP' },
  { id: 'stellar', name: 'Stellar', mark: null, own: null, bridge: 'stellar:mainnet', zerion: null, coin: 'XLM' },
  { id: 'dogecoin', name: 'Dogecoin', mark: null, own: null, bridge: 'doge:mainnet', zerion: null, coin: 'DOGE' },
  { id: 'litecoin', name: 'Litecoin', mark: null, own: null, bridge: 'ltc:mainnet', zerion: null, coin: 'LTC' },
  { id: 'bitcoin-cash', name: 'Bitcoin Cash', mark: null, own: null, bridge: 'bch:mainnet', zerion: null, coin: 'BCH' },
  { id: 'zcash', name: 'Zcash', mark: null, own: null, bridge: 'zec:mainnet', zerion: null, coin: 'ZEC' },
  { id: 'cardano', name: 'Cardano', mark: null, own: null, bridge: 'cardano:mainnet', zerion: null, coin: 'ADA' },
  { id: 'starknet', name: 'Starknet', mark: null, own: null, bridge: 'starknet:mainnet', zerion: null, coin: 'STRK' },
]

/** Tokens shown before any search: the chain's own coin, then the stablecoins most sent. */
const TOP = 4
const PREFERRED = ['USDC', 'USDT', 'ETH', 'BTC', 'wNEAR']

/** A chain by any name an agent or the page may use for it. */
const ALIASES: Record<string, string> = { eth: 'ethereum', mainnet: 'ethereum', arb: 'arbitrum', op: 'optimism', pol: 'polygon', matic: 'polygon', bnb: 'bsc', 'bnb-chain': 'bsc', binance: 'bsc', avax: 'avalanche', sol: 'solana', btc: 'bitcoin', trx: 'tron', apt: 'aptos', ripple: 'xrp', xlm: 'stellar', doge: 'dogecoin', ltc: 'litecoin', bch: 'bitcoin-cash', zec: 'zcash', ada: 'cardano' }

export function receiveChainOf(name: string): (typeof CHAINS)[number] | null {
  const word = name.trim().toLowerCase().replace(/\s+/g, '-')
  return CHAINS.find((chain) => chain.id === (ALIASES[word] ?? word)) ?? null
}

/** Ranks a chain's tokens: its own coin, then the preferred ones, then by name. */
function ranked(symbols: readonly string[], coin: string): string[] {
  const rank = (symbol: string) => (symbol.toUpperCase() === coin.toUpperCase() ? -1 : PREFERRED.findIndex((wanted) => wanted.toUpperCase() === symbol.toUpperCase()) >>> 0)
  return [...symbols].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/**
 * The chains to offer, in order, each with its top few tokens: those NEAR Intents takes
 * there, with the least of each it credits, or the chain's own coin where it takes none.
 * Without the bridge's list (null), the wallet's own chains still show.
 */
export function receiveChains(bridge: readonly IntentsDepositChain[] | null): ReceiveChain[] {
  return CHAINS.flatMap(({ id, name, mark, own, bridge: key, coin }) => {
    const intents = bridge?.find((chain) => chain.key === key)
    if (!own && !intents) return []
    const tokens: ReceiveToken[] = intents
      ? ranked(
          intents.tokens.map((token) => token.symbol),
          coin,
        )
          .slice(0, TOP)
          .map((symbol) => ({ symbol, name: null, min: intents.tokens.find((token) => token.symbol === symbol)?.min ?? null, intents: true }))
      : [{ symbol: coin, name: null, min: null, intents: false }]
    return [{ id, name, mark, own, intents: Boolean(intents), tokens }]
  })
}

/** A token Zerion found, as the search reads it. */
export interface FoundToken {
  symbol: string
  name: string | null
}

/**
 * A chain's tokens matching a search: those NEAR Intents takes there first, with their
 * minimums, then any Zerion knows on the chain that it doesn't. One entry per symbol.
 */
export function searchTokens(chainId: string, query: string, bridge: readonly IntentsDepositChain[] | null, zerion: readonly FoundToken[]): ReceiveToken[] {
  const chain = receiveChainOf(chainId)
  if (!chain) return []
  const wanted = query.trim().toLowerCase()
  const intents = bridge?.find((each) => each.key === chain.bridge)?.tokens ?? []
  const found: ReceiveToken[] = intents.filter((token) => token.symbol.toLowerCase().includes(wanted)).map((token) => ({ symbol: token.symbol, name: null, min: token.min, intents: true }))
  if (chain.own && chain.coin.toLowerCase().includes(wanted) && !found.some((token) => token.symbol.toLowerCase() === chain.coin.toLowerCase())) found.push({ symbol: chain.coin, name: null, min: null, intents: false })
  for (const token of zerion) {
    if (!found.some((each) => each.symbol.toLowerCase() === token.symbol.toLowerCase())) found.push({ symbol: token.symbol, name: token.name, min: null, intents: false })
  }
  const order = ranked(
    found.map((token) => token.symbol),
    chain.coin,
  )
  // An exact match leads, then what NEAR Intents takes, then the chain's usual order.
  const exact = (token: ReceiveToken) => Number(token.symbol.toLowerCase() === wanted)
  return found.sort((a, b) => exact(b) - exact(a) || Number(b.intents) - Number(a.intents) || order.indexOf(a.symbol) - order.indexOf(b.symbol)).slice(0, 20)
}

/** What a receive is asked for: a chain, a token, and how much, if the person said. */
export interface ReceiveAsk {
  chain: string
  asset: string
  /** A plain decimal, or null when not given. */
  amount: string | null
}

/** Whether `amount` is under `min`, both plain decimals. False when either can't be read. */
function below(amount: string, min: string): boolean {
  const a = parseUnits(amount, 36)
  const m = parseUnits(min, 36)
  return a !== null && m !== null && a < m
}

/**
 * Where to receive a token on a chain, NEAR Intents first: its deposit address there
 * when it takes the token and the amount (if given) meets its minimum, so what arrives
 * lands in the Intents balance; otherwise the wallet's own address on that chain; and
 * nothing, plainly, when neither can take it. The wallet's own accounts and the bridge
 * are asked by main; this only decides.
 */
export async function pickReceive(
  ask: ReceiveAsk,
  {
    bridge,
    accounts,
    depositAddress,
  }: { bridge: readonly IntentsDepositChain[] | null; accounts: readonly Account[]; depositAddress: (account: string, key: string) => Promise<{ address: string; memo: string | null } | null> },
): Promise<ReceiveAnswer> {
  const chain = receiveChainOf(ask.chain)
  if (!chain) return { ok: false, reason: 'unknown-chain' }
  if (ask.amount !== null && parseUnits(ask.amount, 36) === null) return { ok: false, reason: 'bad-amount' }
  const own = chain.own ? accounts.find((account) => account.chain === chain.own) : undefined
  const near = accounts.find((account) => account.chain === 'near')?.address
  const token = bridge?.find((each) => each.key === chain.bridge)?.tokens.find((each) => each.symbol.toLowerCase() === ask.asset.trim().toLowerCase())
  const ownAnswer = (why: 'not-in-intents' | 'below-minimum' | 'intents-unavailable'): ReceiveAnswer =>
    own ? { ok: true, kind: 'own', chain: chain.id, chainName: chain.name, asset: token?.symbol ?? ask.asset.trim(), address: own.address, path: own.path, why, min: token?.min ?? null } : { ok: false, reason: why === 'below-minimum' ? 'below-minimum' : 'not-supported', min: token?.min ?? null }

  if (token && chain.bridge && near) {
    if (ask.amount !== null && below(ask.amount, token.min)) return ownAnswer('below-minimum')
    const deposit = await depositAddress(near, chain.bridge).catch(() => null)
    if (!deposit) return ownAnswer('intents-unavailable')
    return { ok: true, kind: 'intents', chain: chain.id, chainName: chain.name, asset: token.symbol, address: deposit.address, memo: deposit.memo, min: token.min, account: near }
  }
  return ownAnswer('not-in-intents')
}
