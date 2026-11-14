import { evmChainOfOneClick, EVM_CHAINS } from '../../shared/evm/chains'
import { isTokenSymbol } from '../../shared/logos'
import type { ReviewPlan, ReviewToken } from '../../shared/review'
import type { ZerionToken } from '../portfolio/zerion'
import type { OneClickToken } from '../routes/one-click'

/** How long review waits for icons. A plan never waits on Zerion longer than this. */
export const REVIEW_ICON_TIMEOUT_MS = 2_500

export interface ReviewIconDeps {
  /** 1Click's tokens, to read what one of its ids is on its own chain. */
  tokens: () => Promise<OneClickToken[] | null>
  /** Zerion's verified tokens on a chain, by symbol. Empty when Zerion can't be asked. */
  search: (symbol: string, zerionChain: string) => Promise<ZerionToken[]>
  /** An icon from Zerion's image host, as a data: URL, or null. */
  icon: (url: string) => Promise<string | null>
  timeoutMs?: number
}

/** Where Zerion knows a token: its chain, and its contract or mint there, or null for the chain's own coin. */
type ZerionPlace = { chain: string; address: string | null }

const zerionChainOfMark = (mark: string): string | null => (mark === 'solana' ? 'solana' : (EVM_CHAINS.find((chain) => chain.id === mark)?.zerion ?? null))
const zerionChainOfOneClick = (code: string): string | null => (code === 'sol' ? 'solana' : (evmChainOfOneClick(code)?.zerion ?? null))
const sameAddress = (a: string | null, b: string | null) => (a === null || b === null ? a === b : /^0x/i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b)

/** Where Zerion would know the token the plan checked, or null where it can't (NEAR's own tokens, say). */
async function placeOf(token: ReviewToken, listed: () => Promise<OneClickToken[] | null>): Promise<ZerionPlace | null> {
  // 1Click's id: read the token's own chain and contract from 1Click's list.
  if (token.id?.includes(':')) {
    const found = ((await listed()) ?? []).find((each) => each.assetId === token.id)
    const chain = found ? zerionChainOfOneClick(found.blockchain) : null
    return found && chain ? { chain, address: found.contract } : null
  }
  const chain = zerionChainOfMark(token.chain)
  return chain ? { chain, address: token.id } : null
}

/** Every token the plan draws, wherever it appears. */
function tokensOf(plan: ReviewPlan): ReviewToken[] {
  return [
    ...plan.flow.out.map((each) => each.token),
    plan.flow.in.token,
    ...plan.transactions.flatMap((tx) => tx.actions.flatMap((action) => (action.move ? [action.move.token] : []))),
    ...plan.actions.flatMap((action) => (action.move ? [action.move.token] : [])),
  ]
}

const keyOf = (token: ReviewToken) => `${token.chain}|${token.id ?? ''}|${token.symbol}`

/**
 * The plan with Zerion's icon on each token Ink ships no logo for. A token's icon is
 * found by what the plan checked it to be, its contract or mint, never by its symbol:
 * Zerion's verified token must have that exact address on that chain. Anything Zerion
 * can't match in time keeps no icon, and the page draws its chain's logo or its letters.
 */
export async function withReviewIcons(plan: ReviewPlan, { tokens, search, icon, timeoutMs = REVIEW_ICON_TIMEOUT_MS }: ReviewIconDeps): Promise<ReviewPlan> {
  const wanted = new Map<string, ReviewToken>()
  for (const token of tokensOf(plan)) if (!isTokenSymbol(token.symbol) && !token.icon) wanted.set(keyOf(token), token)
  if (wanted.size === 0) return plan

  let listed: Promise<OneClickToken[] | null> | null = null
  const listedOnce = () => (listed ??= tokens().catch(() => null))
  const look = async (token: ReviewToken): Promise<string | null> => {
    const place = await placeOf(token, listedOnce)
    if (!place) return null
    const found = (await search(token.symbol, place.chain)).find((each) => each.icon && each.addresses.some((address) => sameAddress(address, place.address)))
    return found?.icon ? icon(found.icon) : null
  }

  const found = new Map<string, string>()
  const all = Promise.all(
    [...wanted].map(async ([key, token]) => {
      const data = await look(token).catch(() => null)
      if (data) found.set(key, data)
    }),
  )
  await Promise.race([all, new Promise((resolve) => setTimeout(resolve, timeoutMs))])
  if (found.size === 0) return plan

  const dress = (token: ReviewToken): ReviewToken => (found.has(keyOf(token)) ? { ...token, icon: found.get(keyOf(token)) as string } : token)
  const dressAction = (action: ReviewPlan['actions'][number]) => (action.move ? { ...action, move: { ...action.move, token: dress(action.move.token) } } : action)
  return {
    ...plan,
    flow: { ...plan.flow, out: plan.flow.out.map((each) => ({ ...each, token: dress(each.token) })), in: { ...plan.flow.in, token: dress(plan.flow.in.token) } },
    transactions: plan.transactions.map((tx) => ({ ...tx, actions: tx.actions.map(dressAction) })),
    actions: plan.actions.map(dressAction),
  }
}
