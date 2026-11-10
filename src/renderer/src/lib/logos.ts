import type { AccountChain } from '../../../shared/accounts'

/** The chains Ink has a mark for: its own account chains, and the EVM networks one EVM address covers. */
export const CHAIN_IDS = ['near', 'ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'solana', 'bitcoin', 'tron', 'sui', 'aptos'] as const
export type ChainId = (typeof CHAIN_IDS)[number]

/** The tokens Ink has a mark for, by symbol. */
export const TOKEN_SYMBOLS = ['NEAR', 'ETH', 'USDC', 'USDT', 'SOL', 'BTC', 'TRX', 'SUI', 'APT'] as const
export type TokenSymbol = (typeof TOKEN_SYMBOLS)[number]

/** Which mark stands for each of Ink's account chains. One EVM address is Ethereum's mark. */
export const ACCOUNT_CHAIN_MARK: Record<AccountChain, ChainId> = {
  near: 'near',
  evm: 'ethereum',
  solana: 'solana',
  bitcoin: 'bitcoin',
  tron: 'tron',
  sui: 'sui',
  aptos: 'aptos',
}

/** Where each token is native. ETH is native on Ethereum and the rollups that use it for gas. */
const NATIVE: Record<TokenSymbol, readonly ChainId[]> = {
  NEAR: ['near'],
  ETH: ['ethereum', 'base', 'arbitrum', 'optimism'],
  USDC: [],
  USDT: [],
  SOL: ['solana'],
  BTC: ['bitcoin'],
  TRX: ['tron'],
  SUI: ['sui'],
  APT: ['aptos'],
}

export const isTokenSymbol = (value: string): value is TokenSymbol => (TOKEN_SYMBOLS as readonly string[]).includes(value.toUpperCase())

export const isChainId = (value: string): value is ChainId => (CHAIN_IDS as readonly string[]).includes(value.toLowerCase())

/**
 * The chain badge to draw on a token's mark, or null. A token on its home chain
 * gets none: NEAR on NEAR reads as a doubled mark, not as information.
 */
export function chainBadge(symbol: string, chain: string | null | undefined): ChainId | null {
  if (!chain || !isChainId(chain)) return null
  const id = chain.toLowerCase() as ChainId
  if (!isTokenSymbol(symbol)) return id
  return NATIVE[symbol.toUpperCase() as TokenSymbol].includes(id) ? null : id
}

/** A row of overlapping marks, at most `max` of them, and how many more there are. */
export function capStack<T>(items: readonly T[], max = 3): { shown: readonly T[]; more: number } {
  if (items.length <= max) return { shown: items, more: 0 }
  return { shown: items.slice(0, max), more: items.length - max }
}
