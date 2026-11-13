import { hexToBytes } from '@noble/hashes/utils.js'
import type { Account } from '../../shared/accounts'
import { isAddressOn, isEvmAddress } from '../../shared/addresses'
import { evmChainOfOneClick, type EvmChain } from '../../shared/evm/chains'
import { isNearAccountId, nearAccountKind } from '../../shared/near/account-id'
import { callsDeposit, callsGas, INTENTS_NEAR, nearCallStep, type NearCall } from '../../shared/near/calls'
import { nearPublicKey } from '../../shared/near/transaction'
import type { PlanFailure, PlanIntent, PlanStep, PlanSwap } from '../../shared/plan'
import type { ChatSwap } from '../../shared/ipc'
import { formatUnits, parseUnits } from '../../shared/token-text'
import { buildEvmTransfer, evmTokenOf } from '../evm/build'
import type { EvmRpc } from '../evm/rpc'
import { PLAN_TTL_MS, SWAP_DEADLINE_MARGIN_MS, type BuiltSwap } from '../plans/store'
import type { OneClickQuote, OneClickQuoteRequest, OneClickQuoteResult, OneClickToken } from './one-click'
import { SLIPPAGE_BPS } from './quoter'
import { accountChainFor, chainCode, tokenOn } from './route'
import { SWAP_DEADLINE_AFTER_PLAN_MS } from './swap-plan'

/**
 * Which legs a payment's step pays, by their place in `swaps`. The builder writes the
 * Intents legs first, all paid by the first step when it's the NEAR one, then each EVM leg
 * paid by its own step, in the same order.
 */
export function legsOfStep(core: { steps: readonly PlanStep[]; swaps?: readonly PlanSwap[] }, step: number): number[] {
  const swaps = core.swaps ?? []
  const intents = swaps.flatMap((swap, index) => (swap.payFrom === 'intents' ? [index] : []))
  const evm = swaps.flatMap((swap, index) => (swap.payFrom === 'evm' ? [index] : []))
  const nearFirst = core.steps[0]?.chain === 'near'
  if (nearFirst && step === 0) return intents
  const evmIndex = step - (nearFirst ? 1 : 0)
  return evm[evmIndex] === undefined ? [] : [evm[evmIndex] as number]
}

/** The most legs one payment is split into. */
export const MAX_LEGS = 3

/** Dollar stablecoins, any of which can pay for another. */
const STABLES = new Set(['USDC', 'USDT', 'USDC.E', 'USDT0', 'DAI', 'USDS'])

/**
 * How much of what a source would pay out at its full balance a leg asks for exactly. An
 * exact payout needs a little more in than the same amount out of an exact input, so a
 * leg that can't cover the rest takes a little under its best.
 */
const PART_OF_BEST = 97n

export interface PayPlanDeps {
  tokens: () => Promise<OneClickToken[] | null>
  /** What each source holds now: `wallet:<asset id>` and `intents:<asset id>`. Null when it can't be read. */
  held: () => Promise<ReadonlyMap<string, bigint> | null>
  quote: (request: OneClickQuoteRequest) => Promise<OneClickQuoteResult>
  /** Whether the NEAR account covers what the calls attach and the most their fees could take. */
  fits: (from: string, deposit: bigint, gas: bigint, calls: number) => Promise<'insufficient-funds' | 'fee-rose' | null>
  evmRpc: (chain: EvmChain) => EvmRpc
  now?: () => number
}

export type PayPlanResult = ({ ok: true; steps: PlanStep[] } & BuiltSwap) | { ok: false; reason: PlanFailure }

/** One way to pay part of it: a token in the Intents balance, or at the wallet's address on an EVM chain. */
interface Source {
  from: 'intents' | 'evm'
  token: OneClickToken
  held: bigint
  chain: EvmChain | null
}

interface Leg {
  source: Source
  quote: OneClickQuote
  /** Exactly what this leg pays out. */
  out: bigint
}

/** A balance in whole tokens, to put sources of different decimals in order. */
const whole = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals

/**
 * A payment of exactly `amount` of a token on a chain, from whatever the wallet holds that
 * can pay for it: the same token, or for a dollar stablecoin any other, in the Intents
 * balance or at the wallet's address on an EVM chain. The largest source goes first, and
 * each leg is an exact-output swap through 1Click to the same recipient, so together they
 * pay exactly the amount. The Intents legs move their tokens in one NEAR transaction; each
 * EVM leg is one transfer on its chain. A refund goes back where each leg came from.
 */
export async function buildPayment(intent: PlanIntent, own: readonly Account[], { tokens, held, quote, fits, evmRpc, now = Date.now }: PayPlanDeps): Promise<PayPlanResult> {
  if (intent.outcome !== 'pay' || !intent.toChain) return { ok: false, reason: 'bad-request' }
  const near = own.find((account) => account.chain === 'near')?.address
  const evmFrom = own.find((account) => account.chain === 'evm')?.address
  if (!near || nearAccountKind(near) !== 'implicit') return { ok: false, reason: 'chain-unavailable' }
  const listed = await tokens().catch(() => null)
  if (!listed) return { ok: false, reason: 'chain-unavailable' }

  const toCode = chainCode(intent.toChain, listed)
  if (!toCode || toCode === 'intents') return { ok: false, reason: 'no-route' }
  const target = tokenOn(intent.asset, toCode, listed)
  if (!target || target === 'ambiguous') return { ok: false, reason: 'no-route' }
  const amount = parseUnits(intent.amount, target.decimals)
  if (amount === null || amount === 0n) return { ok: false, reason: 'bad-request' }

  // Who it pays: an address the person typed (the store checks they did), or their own there.
  const payoutChain = accountChainFor(toCode)
  if (!payoutChain) return { ok: false, reason: 'no-route' }
  if (intent.to && !isAddressOn(payoutChain, intent.to)) return { ok: false, reason: 'bad-address' }
  const payout = intent.to ?? own.find((account) => account.chain === payoutChain)?.address
  if (!payout) return { ok: false, reason: 'recipient-not-allowed' }

  const holdings = await held().catch(() => null)
  if (!holdings) return { ok: false, reason: 'chain-unavailable' }
  const stable = STABLES.has(target.symbol.toUpperCase())
  const sameKind = (token: OneClickToken) => (stable ? STABLES.has(token.symbol.toUpperCase()) : token.symbol.toLowerCase() === target.symbol.toLowerCase())
  const sources: Source[] = listed
    .filter(sameKind)
    .flatMap((token): Source[] => {
      const inIntents = holdings.get(`intents:${token.assetId}`) ?? 0n
      const chain = evmChainOfOneClick(token.blockchain)
      const atWallet = chain && token.contract && evmFrom ? (holdings.get(`wallet:${token.assetId}`) ?? 0n) : 0n
      return [...(inIntents > 0n ? [{ from: 'intents' as const, token, held: inIntents, chain: null }] : []), ...(atWallet > 0n ? [{ from: 'evm' as const, token, held: atWallet, chain }] : [])]
    })
    .sort((a, b) => whole(b.held, b.token.decimals) - whole(a.held, a.token.decimals))

  const deadline = new Date(now() + PLAN_TTL_MS + SWAP_DEADLINE_AFTER_PLAN_MS)
  const ask = (source: Source, swapType: 'EXACT_INPUT' | 'EXACT_OUTPUT', value: bigint, dry: boolean) =>
    quote({
      originAsset: source.token.assetId,
      destinationAsset: target.assetId,
      swapType,
      amount: value,
      depositType: source.from === 'intents' ? 'INTENTS' : 'ORIGIN_CHAIN',
      refundTo: source.from === 'evm' && evmFrom ? evmFrom : near,
      recipient: payout,
      recipientType: 'DESTINATION_CHAIN',
      dry,
      deadline,
      slippageBps: SLIPPAGE_BPS,
    }).catch((): OneClickQuoteResult => ({ ok: false, reason: 'unavailable' }))

  const legs: Leg[] = []
  let left = amount
  for (const source of sources) {
    if (left === 0n || legs.length === MAX_LEGS) break
    // One leg on each EVM chain, so no two transactions there wait on each other's nonce.
    if (source.chain && legs.some((leg) => leg.source.chain?.chainId === source.chain?.chainId)) continue
    const best = await ask(source, 'EXACT_INPUT', source.held, true)
    if (!best.ok) continue
    let out = best.quote.amountOut >= left ? left : (best.quote.amountOut * PART_OF_BEST) / 100n
    let bound = await ask(source, 'EXACT_OUTPUT', out, false)
    // Asked for all of the rest, it may need a touch more than this source holds: then a little less of it.
    if (bound.ok && bound.quote.amountIn > source.held) {
      out = (out * PART_OF_BEST) / 100n
      bound = await ask(source, 'EXACT_OUTPUT', out, false)
    }
    if (!bound.ok || bound.quote.amountIn > source.held || out === 0n) continue
    const { depositAddress, deadline: closes } = bound.quote
    const addressOk = source.from === 'evm' ? isEvmAddress(depositAddress ?? '') : isNearAccountId(depositAddress ?? '')
    if (!depositAddress || !addressOk || !closes || closes.getTime() < now() + PLAN_TTL_MS + SWAP_DEADLINE_MARGIN_MS) continue
    legs.push({ source, quote: bound.quote, out })
    left -= out
  }
  if (legs.length === 0 || left > 0n) return { ok: false, reason: 'insufficient-funds' }

  const termsOf = (leg: Leg): PlanSwap => ({
    via: '1click',
    depositAddress: leg.quote.depositAddress as string,
    deadline: (leg.quote.deadline as Date).toISOString(),
    originAsset: leg.source.token.assetId,
    destinationAsset: target.assetId,
    amountIn: leg.quote.amountIn.toString(),
    amountOut: leg.out.toString(),
    minAmountOut: leg.out.toString(),
    sendSymbol: leg.source.token.symbol,
    getSymbol: target.symbol,
    getDecimals: String(target.decimals),
    getChain: target.blockchain,
    recipient: payout,
    refundTo: leg.source.from === 'evm' && evmFrom ? evmFrom : near,
    feeBps: String(leg.quote.feeBps),
    seconds: String(Math.round(leg.quote.seconds)),
    payFrom: leg.source.from,
    sendDecimals: String(leg.source.token.decimals),
  })

  // The Intents legs first, in one NEAR transaction; then each EVM leg's transfer.
  const steps: PlanStep[] = []
  const swaps: PlanSwap[] = []
  const fromIntents = legs.filter((leg) => leg.source.from === 'intents')
  if (fromIntents.length > 0) {
    const calls: NearCall[] = fromIntents.map((leg) => ({ method: 'mt_transfer', receiverId: leg.quote.depositAddress as string, tokenId: leg.source.token.assetId, amount: leg.quote.amountIn }))
    try {
      if (await fits(near, callsDeposit(calls), callsGas(calls), calls.length)) return { ok: false, reason: 'insufficient-funds' }
    } catch {
      return { ok: false, reason: 'chain-unavailable' }
    }
    steps.push(nearCallStep({ signerId: near, publicKey: nearPublicKey(hexToBytes(near)), receiverId: INTENTS_NEAR, calls }))
    swaps.push(...fromIntents.map(termsOf))
  }
  for (const leg of legs.filter((each) => each.source.from === 'evm')) {
    const chain = leg.source.chain as EvmChain
    const rpc = evmRpc(chain)
    const token = await evmTokenOf(leg.source.token.contract as string, chain, rpc, [leg.source.token])
    if ('failure' in token) return { ok: false, reason: token.failure }
    const built = await buildEvmTransfer(rpc, { chainId: chain.chainId, from: evmFrom as string, to: leg.quote.depositAddress as string, ...token, amount: leg.quote.amountIn })
    if (!built.ok) return built
    steps.push(...built.steps)
    swaps.push({ ...termsOf(leg), sendChainId: String(chain.chainId), sendToken: token.token })
  }
  return { ok: true, steps, swaps, payout: { address: payout, chain: payoutChain } }
}

/**
 * Where a whole payment stands from where each leg does: failed or refunded as soon as any
 * leg is, done only once every leg is, and otherwise as far as the slowest leg has got.
 * `got` is the exact total once done, since each leg pays exactly its amount. Null before
 * any leg has been heard of.
 */
export function paymentProgress(swaps: readonly PlanSwap[], legs: readonly (ChatSwap | null)[]): ChatSwap | null {
  const known = legs.filter((leg): leg is ChatSwap => leg !== null)
  if (known.length === 0) return null
  const first = swaps[0]
  const link = known.find((leg) => leg.link)?.link ?? null
  const refunded = known.flatMap((leg) => (leg.refunded ? [leg.refunded] : [])).join(' + ') || null
  const any = (stage: ChatSwap['stage']) => known.some((leg) => leg.stage === stage)
  if (any('failed')) return { stage: 'failed', got: null, refunded, link }
  if (any('refunded')) return { stage: 'refunded', got: null, refunded, link }
  if (any('unknown')) return { stage: 'unknown', got: null, refunded, link }
  if (known.length === swaps.length && known.every((leg) => leg.stage === 'done') && first) {
    const total = swaps.reduce((sum, swap) => sum + BigInt(swap.amountOut), 0n)
    return { stage: 'done', got: `${formatUnits(total, Number(first.getDecimals))} ${first.getSymbol}`, refunded: null, link }
  }
  return { stage: known.length === swaps.length && known.every((leg) => leg.stage !== 'deposited') ? 'swapping' : 'deposited', got: null, refunded: null, link }
}
