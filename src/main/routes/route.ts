import type { AccountChain } from '../../shared/accounts'
import { EVM_CHAINS as EVM_CHAIN_LIST } from '../../shared/evm/chains'
import { parseUnits } from '../../shared/token-text'
import { originName } from '../portfolio/intents'
import type { OneClickToken } from './one-click'

/**
 * Where a payment comes from: the wallet on a chain Ink signs for, or the NEAR
 * Intents balance, which the NEAR account controls whatever chain a token came from.
 */
export type RouteSource = 'wallet' | 'intents'

/** The chains Ink can sign a payment on from the wallet, by 1Click's names: NEAR, Solana, and every EVM chain it takes deposits from. */
export const SIGNS_ON: ReadonlySet<string> = new Set(['near', 'sol', ...EVM_CHAIN_LIST.flatMap((chain) => (chain.oneClick ? [chain.oneClick] : []))])

/** 1Click's names for EVM chains, which all share the wallet's one EVM address. */
const EVM_CHAINS = new Set(['eth', 'base', 'arb', 'op', 'pol', 'bsc', 'avax', 'gnosis', 'bera', 'scroll', 'monad', 'plasma', 'abs', 'hood', 'xlayer', 'adi'])

/** The wallet's own account that receives on each of 1Click's chains, where it has one. */
export function accountChainFor(chain: string): AccountChain | null {
  if (chain === 'near') return 'near'
  if (EVM_CHAINS.has(chain)) return 'evm'
  const others: Record<string, AccountChain> = { sol: 'solana', btc: 'bitcoin', tron: 'tron', sui: 'sui', aptos: 'aptos' }
  return others[chain] ?? null
}

/** How people and agents name chains, as 1Click's short names. `intents` is the Intents balance. */
const CHAIN_WORDS: Record<string, string> = {
  intents: 'intents',
  'near-intents': 'intents',
  nearintents: 'intents',
  ethereum: 'eth',
  mainnet: 'eth',
  arbitrum: 'arb',
  optimism: 'op',
  polygon: 'pol',
  matic: 'pol',
  bnb: 'bsc',
  binance: 'bsc',
  'bnb-chain': 'bsc',
  bnbchain: 'bsc',
  avalanche: 'avax',
  berachain: 'bera',
  solana: 'sol',
  bitcoin: 'btc',
  dogecoin: 'doge',
  litecoin: 'ltc',
  zcash: 'zec',
  ripple: 'xrp',
  ada: 'cardano',
  xlm: 'stellar',
  'x-layer': 'xlayer',
  trx: 'tron',
  apt: 'aptos',
}

/** 1Click's short name for a chain as it was written: "Base", "solana", "arb". Null when no listed token is on it. */
export function chainCode(name: string, tokens: readonly OneClickToken[]): string | null {
  const word = name.trim().toLowerCase().replace(/\s+/g, '-')
  const code = CHAIN_WORDS[word] ?? word
  if (code === 'intents') return code
  return tokens.some((token) => token.blockchain === code) ? code : null
}

/** A chain as a person reads it: "Base", "the NEAR Intents balance". */
export function chainName(code: string): string {
  return code === 'intents' ? 'the NEAR Intents balance' : originName(code)
}

/**
 * The token a name means on one chain: its symbol, contract or 1Click id. Native NEAR is
 * wrapped NEAR to 1Click, since NEAR itself isn't a token. Null for none; `ambiguous` when
 * two tokens share the symbol there, which is never settled by guessing.
 */
export function tokenOn(name: string, chain: string, tokens: readonly OneClickToken[]): OneClickToken | 'ambiguous' | null {
  const wanted = name.trim().toLowerCase()
  const word = chain === 'near' && wanted === 'near' ? 'wnear' : wanted
  const found = tokens.filter(
    (token) => token.blockchain === chain && (token.symbol.toLowerCase() === word || token.assetId.toLowerCase() === word || token.contract?.toLowerCase() === word),
  )
  return found.length === 1 ? (found[0] as OneClickToken) : found.length > 1 ? 'ambiguous' : null
}

/** What get_quote and create_plan are asked: assets and chains as written, and an amount in whole tokens. */
export interface RouteAsk {
  fromAsset: string
  fromChain?: string
  toAsset: string
  toChain?: string
  amount: string
}

/** One way to pay: where from, which token, and how much of it is held there. */
export interface RouteLeg {
  source: RouteSource
  from: OneClickToken
  /** In the token's smallest unit. */
  amount: bigint
  /** What that source holds of it now. */
  held: bigint
}

/**
 * Why there's no route: a chain or token 1Click doesn't list, two tokens of one name
 * on a chain, an amount that isn't one, funds only on a chain Ink can't sign for yet
 * (`cannot-sign`, with that chain), or a same-token send on a chain where Ink can't
 * send tokens yet (`direct-not-built`).
 */
export type RouteFailure =
  | { reason: 'unknown-chain'; name: string }
  | { reason: 'unknown-asset'; name: string; chain: string | null }
  | { reason: 'ambiguous-asset'; name: string; chain: string }
  | { reason: 'bad-amount' }
  | { reason: 'cannot-sign'; chain: string }
  | { reason: 'direct-not-built'; chain: string }

export type Route =
  /** A plain transfer on the chain itself. Nothing is swapped. */
  | { kind: 'direct'; chain: string; asset: OneClickToken; amount: bigint; held: bigint }
  /** Through NEAR Intents: each leg is a way to pay, best first by what's held. */
  | { kind: 'intents'; legs: RouteLeg[]; to: OneClickToken; toIntents: boolean }
  | ({ kind: 'none' } & RouteFailure)

/**
 * Picks how a payment would go, without asking anyone for a price:
 * - a direct transfer when the token and chain stay the same and Ink signs on that chain;
 * - otherwise through NEAR Intents, paid from the wallet on a chain Ink signs for, or
 *   from the Intents balance, whichever holds the token. Both are kept when both do, so
 *   the quotes can be compared.
 * `held` maps `wallet:<asset id>` and `intents:<asset id>` to what each holds.
 */
export function pickRoute(ask: RouteAsk, tokens: readonly OneClickToken[], held: ReadonlyMap<string, bigint>): Route {
  const holding = (source: RouteSource, assetId: string) => held.get(`${source}:${assetId}`) ?? 0n
  const fromChain = ask.fromChain ? chainCode(ask.fromChain, tokens) : null
  if (ask.fromChain && fromChain === null) return { kind: 'none', reason: 'unknown-chain', name: ask.fromChain }
  const toChainAsked = ask.toChain ? chainCode(ask.toChain, tokens) : null
  if (ask.toChain && toChainAsked === null) return { kind: 'none', reason: 'unknown-chain', name: ask.toChain }

  // Which token is meant, and where it can be paid from.
  const legsFor = (from: OneClickToken, sources: RouteSource[]): Omit<RouteLeg, 'amount'>[] =>
    sources.map((source) => ({ source, from, held: holding(source, from.assetId) }))
  let candidates: Omit<RouteLeg, 'amount'>[]
  if (fromChain === 'intents') {
    // In the Intents balance a symbol can come from several chains: the ones held, most first.
    const inIntents = tokens.filter((token) => token.symbol.toLowerCase() === ask.fromAsset.trim().toLowerCase() || token.assetId === ask.fromAsset.trim())
    candidates = intentsLegs(inIntents, holding).filter((leg) => leg.held > 0n)
    if (candidates.length === 0) {
      const named = tokenOn(ask.fromAsset, 'near', tokens)
      if (named === 'ambiguous') return { kind: 'none', reason: 'ambiguous-asset', name: ask.fromAsset, chain: 'near' }
      if (!named) return { kind: 'none', reason: 'unknown-asset', name: ask.fromAsset, chain: 'intents' }
      candidates = legsFor(named, ['intents'])
    }
  } else {
    const chain = fromChain ?? 'near'
    const from = tokenOn(ask.fromAsset, chain, tokens)
    if (from === 'ambiguous') return { kind: 'none', reason: 'ambiguous-asset', name: ask.fromAsset, chain }
    if (!from) {
      if (fromChain) return { kind: 'none', reason: 'unknown-asset', name: ask.fromAsset, chain }
      // No chain named and not on NEAR: held in the Intents balance, or only somewhere Ink can't sign.
      const route = pickRoute({ ...ask, fromChain: 'intents' }, tokens, held)
      if (route.kind !== 'none' || route.reason !== 'unknown-asset') return route
      const elsewhere = tokens.find((token) => token.symbol.toLowerCase() === ask.fromAsset.trim().toLowerCase())
      return elsewhere ? { kind: 'none', reason: 'cannot-sign', chain: elsewhere.blockchain } : { kind: 'none', reason: 'unknown-asset', name: ask.fromAsset, chain: null }
    }
    const sources: RouteSource[] = [...(SIGNS_ON.has(chain) ? (['wallet'] as const) : []), ...(holding('intents', from.assetId) > 0n ? (['intents'] as const) : [])]
    if (sources.length === 0) return { kind: 'none', reason: 'cannot-sign', chain }
    candidates = legsFor(from, sources)
  }

  // Each leg reads the amount at its own token's decimals: USDC has 18 on BNB Chain and 6 elsewhere.
  const legs = candidates.flatMap((leg) => {
    const amount = parseUnits(ask.amount.trim(), leg.from.decimals)
    return amount === null || amount === 0n ? [] : [{ ...leg, amount }]
  })
  const first = legs[0]
  if (!first) return { kind: 'none', reason: 'bad-amount' }
  const amount = first.amount

  // Where it goes: the chain named, or the chain it's on (NEAR for the Intents balance).
  const sameChain = first.source === 'intents' && fromChain === 'intents' ? 'near' : first.from.blockchain
  const toChain = toChainAsked ?? sameChain
  const toIntents = toChain === 'intents'
  const toLookup = toIntents ? 'near' : toChain
  let to = tokenOn(ask.toAsset, toLookup, tokens)
  if (!to && !toChainAsked) {
    // No chain named and none on the one it's on: the chain whose own coin it is ("NEAR to SOL"), or the one chain it lives on.
    const named = tokens.filter((token) => token.symbol.toLowerCase() === ask.toAsset.trim().toLowerCase())
    const natives = named.filter((token) => token.contract === null)
    const homes = new Set((natives.length > 0 ? natives : named).map((token) => token.blockchain))
    const [home] = homes
    if (homes.size === 1 && home) to = tokenOn(ask.toAsset, home, tokens)
    // NEAR's own coin, which 1Click lists only as wNEAR on NEAR.
    if (!to && ask.toAsset.trim().toLowerCase() === 'near') to = tokenOn('NEAR', 'near', tokens)
  }
  if (to === 'ambiguous') return { kind: 'none', reason: 'ambiguous-asset', name: ask.toAsset, chain: toLookup }
  if (!to) return { kind: 'none', reason: 'unknown-asset', name: ask.toAsset, chain: toChainAsked ? toChain : null }

  const wallet = legs.find((leg) => leg.source === 'wallet')
  if (!toIntents && wallet && to.assetId === wallet.from.assetId && to.blockchain === wallet.from.blockchain) {
    // The same token on the same chain needs no swap. Ink sends native NEAR itself; tokens on NEAR come later (#72).
    const native = to.blockchain === 'near' && ask.fromAsset.trim().toLowerCase() === 'near' && ask.toAsset.trim().toLowerCase() === 'near'
    if (native) return { kind: 'direct', chain: 'near', asset: to, amount, held: wallet.held }
    const fromIntents = legs.filter((leg) => leg.source === 'intents')
    if (fromIntents.length === 0) return { kind: 'none', reason: 'direct-not-built', chain: to.blockchain }
    return { kind: 'intents', legs: fromIntents, to, toIntents }
  }
  // Paying more than one source holds is still quoted, from the one that holds most.
  const order = (leg: RouteLeg) => (leg.held >= leg.amount ? 2 : 0) + (leg.source === 'wallet' ? 1 : 0)
  return { kind: 'intents', legs: [...legs].sort((a, b) => order(b) - order(a) || (b.held > a.held ? 1 : b.held < a.held ? -1 : 0)), to, toIntents }
}

/** Each token's leg from the Intents balance, the most held first. */
function intentsLegs(tokens: OneClickToken[], holding: (source: RouteSource, assetId: string) => bigint): Omit<RouteLeg, 'amount'>[] {
  return tokens.map((from) => ({ source: 'intents' as const, from, held: holding('intents', from.assetId) })).sort((a, b) => (b.held > a.held ? 1 : b.held < a.held ? -1 : 0))
}
