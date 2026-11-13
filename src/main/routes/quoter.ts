import type { Account } from '../../shared/accounts'
import type { PortfolioResult } from '../../shared/portfolio'
import { formatUnits, parseUnits } from '../../shared/token-text'
import type { VaultResult } from '../../shared/vault'
import type { OneClickFailure, OneClickQuote, OneClickQuoteRequest, OneClickQuoteResult, OneClickToken } from './one-click'
import { accountChainFor, pickRoute, SIGNS_ON, type Route, type RouteAsk, type RouteFailure, type RouteLeg, type RouteSource } from './route'

/** 1% either way, 1Click's own suggestion: enough for a quote to hold for a few minutes. */
export const SLIPPAGE_BPS = 100

/** How long a quote's swap has before it's refunded. A dry quote needs one too. */
const DEADLINE_MS = 30 * 60_000

export interface QuoterDeps {
  /** The wallet's own addresses, only while unlocked. */
  accounts: () => Promise<VaultResult<{ accounts: Account[] }>>
  portfolio: () => Promise<PortfolioResult>
  /** 1Click's token list, kept a few minutes. */
  tokens: () => Promise<OneClickToken[] | null>
  quote: (request: OneClickQuoteRequest) => Promise<OneClickQuoteResult>
  /** The most a NEAR transfer to the account could cost, yoctoNEAR, or null if NEAR can't say. */
  nearFee: (to: string) => Promise<bigint | null>
  now?: () => number
}

/** An amount as a person reads it, with its token. */
export interface QuoteAmount {
  amount: string
  symbol: string
  /** 1Click's name for the chain: `near`, `base`. */
  chain: string
}

export type QuoteOutcome =
  | {
      ok: true
      kind: 'direct'
      send: QuoteAmount
      /** Most the network fee could be, in NEAR, or null when NEAR couldn't say. */
      fee: string | null
      held: QuoteAmount
      /** Null when the balances couldn't be read, so nothing was checked. */
      enough: boolean | null
    }
  | {
      ok: true
      kind: 'intents'
      source: RouteSource
      send: QuoteAmount & { usd: number | null }
      get: QuoteAmount & { usd: number | null }
      least: QuoteAmount
      /** Taken from the payout to send it on its chain, already counted in `get`. */
      withdrawFee: QuoteAmount | null
      feeBps: number
      seconds: number
      /** Where the payout goes: the wallet's own address there, the Intents balance as asked, or the Intents balance for want of an address. */
      paidTo: 'own-address' | 'intents' | 'no-own-address'
      /** Whether the Ink signs on the token's own chain. */
      signsOrigin: boolean
      held: QuoteAmount
      /** Null when the balances couldn't be read, so nothing was checked. */
      enough: boolean | null
      /** Both the wallet and the Intents balance were quoted, and this was the better. */
      compared: boolean
    }
  | { ok: false; reason: 'locked' | 'no-vault' | 'tokens-unavailable' }
  | ({ ok: false } & RouteFailure)
  | { ok: false; reason: OneClickFailure; chain: string }

const amountOf = (raw: bigint, token: OneClickToken, symbol = token.symbol): QuoteAmount => ({ amount: formatUnits(raw, token.decimals), symbol, chain: token.blockchain })

/** A route that isn't one, as the quote's answer. */
function failureOf(route: Extract<Route, { kind: 'none' }>): QuoteOutcome {
  const failure: Record<string, unknown> = { ...route }
  delete failure.kind
  return { ok: false, ...(failure as RouteFailure) }
}

/** What each source holds of each token, from the last portfolio read: `wallet:<asset id>` and `intents:<asset id>`. */
export function holdingsOf(portfolio: PortfolioResult): Map<string, bigint> {
  const held = new Map<string, bigint>()
  if (!portfolio.ok) return held
  const nearAvailable = parseUnits(portfolio.near.available, 24)
  if (nearAvailable !== null) held.set('wallet:nep141:wrap.near', nearAvailable)
  for (const token of portfolio.tokens) {
    const raw = parseUnits(token.amount, token.decimals)
    if (raw === null || !token.contract) continue
    if (token.group === 'near') held.set(`wallet:nep141:${token.contract}`, raw)
    if (token.group === 'intents') held.set(`intents:${token.contract}`, raw)
  }
  return held
}

/**
 * What a payment would give now, by the route Ink would take. Main picks the route and
 * the addresses: the payout goes to the wallet's own address on its chain, or into the
 * Intents balance, and a refund always goes back to the wallet's NEAR account. When the
 * wallet and the Intents balance both cover it, both are quoted and the better is kept.
 */
export function createQuoter({ accounts, portfolio, tokens, quote, nearFee, now = Date.now }: QuoterDeps) {
  return async function quoteRoute(ask: RouteAsk): Promise<QuoteOutcome> {
    const own = await accounts().catch(() => ({ ok: false, reason: 'unavailable' }) as const)
    if (!own.ok) return { ok: false, reason: own.reason === 'no-vault' ? 'no-vault' : own.reason === 'locked' ? 'locked' : 'tokens-unavailable' }
    const near = own.accounts.find((account) => account.chain === 'near')?.address
    const listed = await tokens().catch(() => null)
    if (!near || !listed) return { ok: false, reason: 'tokens-unavailable' }
    const read = await portfolio().catch((): PortfolioResult => ({ ok: false, reason: 'unavailable' }))
    const route = pickRoute(ask, listed, holdingsOf(read))
    if (route.kind === 'none') return failureOf(route)

    if (route.kind === 'direct') {
      const fee = await nearFee(near).catch(() => null)
      return {
        ok: true,
        kind: 'direct',
        send: amountOf(route.amount, route.asset, 'NEAR'),
        fee: fee === null ? null : formatUnits(fee, 24),
        held: amountOf(route.held, route.asset, 'NEAR'),
        enough: read.ok ? route.held >= route.amount + (fee ?? 0n) : null,
      }
    }

    const ownChain = route.toIntents ? null : accountChainFor(route.to.blockchain)
    const ownAddress = ownChain ? own.accounts.find((account) => account.chain === ownChain)?.address : undefined
    const paidTo = route.toIntents ? 'intents' : ownAddress ? 'own-address' : 'no-own-address'
    const ask1Click = (leg: RouteLeg) =>
      quote({
        originAsset: leg.from.assetId,
        destinationAsset: route.to.assetId,
        amount: leg.amount,
        depositType: leg.source === 'wallet' ? 'ORIGIN_CHAIN' : 'INTENTS',
        refundTo: near,
        recipient: paidTo === 'own-address' && ownAddress ? ownAddress : near,
        recipientType: paidTo === 'own-address' ? 'DESTINATION_CHAIN' : 'INTENTS',
        dry: true,
        deadline: new Date(now() + DEADLINE_MS),
        slippageBps: SLIPPAGE_BPS,
      }).catch((): OneClickQuoteResult => ({ ok: false, reason: 'unavailable' }))

    // Every way to pay that covers it is quoted; with none, the one holding most.
    const covering = route.legs.filter((leg) => leg.held >= leg.amount)
    const tried = covering.length > 0 ? covering : route.legs.slice(0, 1)
    let answers = await Promise.all(tried.map(async (leg) => ({ leg, result: await ask1Click(leg) })))
    if (!answers.some((answer) => answer.result.ok) && covering.length === 0 && route.legs.length > 1) {
      answers = [...answers, ...(await Promise.all(route.legs.slice(1, 2).map(async (leg) => ({ leg, result: await ask1Click(leg) }))))]
    }
    const quoted = answers.flatMap(({ leg, result }) => (result.ok ? [{ leg, quote: result.quote }] : []))
    const best = quoted.reduce<{ leg: RouteLeg; quote: OneClickQuote } | null>((top, next) => (!top || next.quote.amountOut > top.quote.amountOut ? next : top), null)
    if (!best) {
      const failed = answers.find((answer) => !answer.result.ok)?.result
      return { ok: false, reason: failed && !failed.ok ? failed.reason : 'unavailable', chain: route.to.blockchain }
    }

    const { leg, quote: q } = best
    const nativeNear = leg.source === 'wallet' && leg.from.assetId === 'nep141:wrap.near'
    return {
      ok: true,
      kind: 'intents',
      source: leg.source,
      send: { ...amountOf(leg.amount, leg.from, nativeNear ? 'NEAR' : leg.from.symbol), usd: q.amountInUsd },
      get: { ...amountOf(q.amountOut, route.to), usd: q.amountOutUsd },
      least: amountOf(q.minAmountOut, route.to),
      withdrawFee: q.withdrawFee > 0n ? amountOf(q.withdrawFee, route.to) : null,
      feeBps: q.feeBps,
      seconds: q.seconds,
      paidTo,
      signsOrigin: SIGNS_ON.has(leg.from.blockchain),
      held: amountOf(leg.held, leg.from, nativeNear ? 'NEAR' : leg.from.symbol),
      enough: read.ok ? leg.held >= leg.amount : null,
      compared: quoted.length > 1,
    }
  }
}
