import { hexToBytes } from '@noble/hashes/utils.js'
import type { Account } from '../../shared/accounts'
import { isAddressOn } from '../../shared/addresses'
import { isNearAccountId, nearAccountKind } from '../../shared/near/account-id'
import { callsDeposit, callsGas, nearCallStep, WRAP_NEAR, type NearCall } from '../../shared/near/calls'
import { nearPublicKey } from '../../shared/near/transaction'
import type { PlanFailure, PlanIntent, PlanStep } from '../../shared/plan'
import { PLAN_TTL_MS, SWAP_DEADLINE_MARGIN_MS, type BuiltSwap } from '../plans/store'
import { type OneClickFailure, type OneClickQuoteRequest, type OneClickQuoteResult, type OneClickToken } from './one-click'
import { SLIPPAGE_BPS } from './quoter'
import { accountChainFor, pickRoute } from './route'

/**
 * How long a swap's deposit address lives past the plan's own expiry. 1Click refunds
 * whatever hasn't swapped by then; the plan can't be sent after it expires anyway.
 */
export const SWAP_DEADLINE_AFTER_PLAN_MS = 30 * 60_000

export interface SwapPlanDeps {
  tokens: () => Promise<OneClickToken[] | null>
  quote: (request: OneClickQuoteRequest) => Promise<OneClickQuoteResult>
  /** Whether the NEAR account covers what the calls attach and the most their fees could take. Throws when NEAR can't be asked. */
  fits: (from: string, deposit: bigint, gas: bigint, calls: number) => Promise<'insufficient-funds' | 'fee-rose' | null>
  now?: () => number
}

export type SwapPlanResult = ({ ok: true; steps: PlanStep[] } & BuiltSwap) | { ok: false; reason: PlanFailure }

const QUOTE_FAILURES: Record<OneClickFailure, PlanFailure> = {
  'too-small': 'no-route',
  'no-route': 'no-route',
  'bad-recipient': 'recipient-not-allowed',
  mismatch: 'chain-unavailable',
  unavailable: 'chain-unavailable',
}

/**
 * A swap of NEAR from the wallet through NEAR Intents, as a plan's steps. Main picks the
 * route and every address: 1Click pays the person's own address on the chain it pays out
 * on, their Intents balance, or an address they typed in the chat that's valid there (on
 * an EVM chain, Solana or NEAR so far), and refunds their NEAR account. The binding quote's deposit
 * address goes into one transaction to wrap.near: register the person and the deposit
 * address (refunded when either already is), wrap the NEAR, and send that wNEAR to it.
 *
 * Anything else, such as paying from the Intents balance or a token other than NEAR, isn't
 * built yet: the plan stays a draft.
 */
export async function buildOneClickSwap(intent: PlanIntent, own: readonly Account[], { tokens, quote, fits, now = Date.now }: SwapPlanDeps): Promise<SwapPlanResult> {
  const NOT_YET: SwapPlanResult = { ok: true, steps: [] }
  if (intent.outcome !== 'swap' || !intent.toAsset) return NOT_YET
  const near = own.find((account) => account.chain === 'near')?.address
  if (!near || nearAccountKind(near) !== 'implicit') return { ok: false, reason: 'chain-unavailable' }
  const listed = await tokens().catch(() => null)
  if (!listed) return { ok: false, reason: 'chain-unavailable' }

  // Only the wallet pays here: the Intents balance can pay once Ink spends from it (#29).
  const route = pickRoute(
    { fromAsset: intent.asset, ...(intent.chain ? { fromChain: intent.chain } : {}), toAsset: intent.toAsset, ...(intent.toChain ? { toChain: intent.toChain } : {}), amount: intent.amount },
    listed,
    new Map(),
  )
  if (route.kind === 'none') return route.reason === 'bad-amount' ? { ok: false, reason: 'bad-request' } : route.reason === 'cannot-sign' || route.reason === 'direct-not-built' ? NOT_YET : { ok: false, reason: 'no-route' }
  if (route.kind !== 'intents') return NOT_YET
  const leg = route.legs.find((candidate) => candidate.source === 'wallet')
  if (!leg || leg.from.assetId !== `nep141:${WRAP_NEAR}`) return NOT_YET

  // Who it pays: an address the person typed (the store checks they did), or their own there.
  const payoutChain = route.toIntents ? 'near' : accountChainFor(route.to.blockchain)
  let payout: string | undefined
  if (intent.to) {
    // Only where Ink can tell a real address from a mistyped one, since a payout can't be undone.
    if (!payoutChain || !isAddressOn(payoutChain, intent.to)) return { ok: false, reason: 'bad-address' }
    payout = intent.to
  } else {
    payout = payoutChain ? own.find((account) => account.chain === payoutChain)?.address : undefined
  }
  if (!payoutChain || !payout) return { ok: false, reason: 'recipient-not-allowed' }

  const quoted = await quote({
    originAsset: leg.from.assetId,
    destinationAsset: route.to.assetId,
    amount: leg.amount,
    depositType: 'ORIGIN_CHAIN',
    refundTo: near,
    recipient: payout,
    recipientType: route.toIntents ? 'INTENTS' : 'DESTINATION_CHAIN',
    dry: false,
    deadline: new Date(now() + PLAN_TTL_MS + SWAP_DEADLINE_AFTER_PLAN_MS),
    slippageBps: SLIPPAGE_BPS,
  }).catch((): OneClickQuoteResult => ({ ok: false, reason: 'unavailable' }))
  if (!quoted.ok) return { ok: false, reason: QUOTE_FAILURES[quoted.reason] }
  const { depositAddress, deadline } = quoted.quote
  // The deposit goes by ft_transfer, so the address must be a NEAR account; and it must outlive the plan.
  if (!depositAddress || !isNearAccountId(depositAddress) || !deadline || deadline.getTime() < now() + PLAN_TTL_MS + SWAP_DEADLINE_MARGIN_MS) return { ok: false, reason: 'chain-unavailable' }

  const calls: NearCall[] = [
    { method: 'storage_deposit', accountId: near },
    { method: 'storage_deposit', accountId: depositAddress },
    { method: 'near_deposit', amount: leg.amount },
    { method: 'ft_transfer', receiverId: depositAddress, amount: leg.amount },
  ]
  try {
    const unfit = await fits(near, callsDeposit(calls), callsGas(calls), calls.length)
    if (unfit) return { ok: false, reason: 'insufficient-funds' }
  } catch {
    return { ok: false, reason: 'chain-unavailable' }
  }

  return {
    ok: true,
    steps: [nearCallStep({ signerId: near, publicKey: nearPublicKey(hexToBytes(near)), receiverId: WRAP_NEAR, calls })],
    swap: {
      via: '1click',
      depositAddress,
      deadline: deadline.toISOString(),
      originAsset: leg.from.assetId,
      destinationAsset: route.to.assetId,
      amountIn: leg.amount.toString(),
      amountOut: quoted.quote.amountOut.toString(),
      minAmountOut: quoted.quote.minAmountOut.toString(),
      sendSymbol: 'NEAR',
      getSymbol: route.to.symbol,
      getDecimals: String(route.to.decimals),
      getChain: route.toIntents ? 'intents' : route.to.blockchain,
      recipient: payout,
      refundTo: near,
      feeBps: String(quoted.quote.feeBps),
      seconds: String(Math.round(quoted.quote.seconds)),
    },
    payout: { address: payout, chain: payoutChain },
  }
}
