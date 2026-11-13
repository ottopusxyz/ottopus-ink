import { hexToBytes } from '@noble/hashes/utils.js'
import type { Account } from '../../shared/accounts'
import { isAddressOn, isEvmAddress } from '../../shared/addresses'
import { evmChainOfOneClick, type EvmChain } from '../../shared/evm/chains'
import { buildEvmTransfer, evmTokenOf } from '../evm/build'
import type { EvmRpc } from '../evm/rpc'
import { isNearAccountId, nearAccountKind } from '../../shared/near/account-id'
import { callsDeposit, callsGas, INTENTS_NEAR, nearCallStep, WRAP_NEAR, type NearCall } from '../../shared/near/calls'
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
  /** Each EVM chain's RPC, for a swap the wallet pays on an EVM chain. */
  evmRpc?: (chain: EvmChain) => EvmRpc
  /** What the Intents balance holds now, as `intents:<asset id>`. Null when it can't be read. */
  held: () => Promise<ReadonlyMap<string, bigint> | null>
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
 * A swap through NEAR Intents, as a plan's steps. Main picks the route and every address:
 * 1Click pays the person's own address on the chain it pays out on, their Intents balance,
 * or an address they typed in the chat that's valid there (on an EVM chain, Solana or
 * NEAR so far), and refunds them. Two ways to pay, whichever the route prefers:
 * - NEAR from the wallet: one transaction to wrap.near registers the person and the
 *   deposit address (refunded when either already is), wraps the NEAR, and sends that
 *   wNEAR to the deposit address. A refund comes back to the NEAR account.
 * - A token in the Intents balance: one mt_transfer inside intents.near moves it to the
 *   deposit address. A refund comes back into the Intents balance. The same token paid
 *   out on its own chain is a withdrawal.
 *
 * Anything else, such as a token on NEAR outside the Intents balance, isn't built yet:
 * the plan stays a draft.
 */
export async function buildOneClickSwap(intent: PlanIntent, own: readonly Account[], { tokens, held, quote, fits, evmRpc, now = Date.now }: SwapPlanDeps): Promise<SwapPlanResult> {
  const NOT_YET: SwapPlanResult = { ok: true, steps: [] }
  if (intent.outcome !== 'swap' || !intent.toAsset) return NOT_YET
  const near = own.find((account) => account.chain === 'near')?.address
  if (!near || nearAccountKind(near) !== 'implicit') return { ok: false, reason: 'chain-unavailable' }
  const listed = await tokens().catch(() => null)
  if (!listed) return { ok: false, reason: 'chain-unavailable' }

  // The Intents balance as it is now, so a deposit that just landed can pay.
  const holdings = await held().catch(() => null)
  const route = pickRoute(
    { fromAsset: intent.asset, ...(intent.chain ? { fromChain: intent.chain } : {}), toAsset: intent.toAsset, ...(intent.toChain ? { toChain: intent.toChain } : {}), amount: intent.amount },
    listed,
    holdings ?? new Map(),
  )
  if (route.kind === 'none') return route.reason === 'bad-amount' ? { ok: false, reason: 'bad-request' } : route.reason === 'cannot-sign' || route.reason === 'direct-not-built' ? NOT_YET : { ok: false, reason: 'no-route' }
  if (route.kind !== 'intents') return NOT_YET
  // The first leg the route prefers that Ink can pay from: NEAR from the wallet, or anything in the Intents balance.
  // The first leg the route prefers that Ink can pay from: NEAR or a coin or token on an EVM chain from the wallet, or anything in the Intents balance.
  const evmFrom = own.find((account) => account.chain === 'evm')?.address
  const leg = route.legs.find((candidate) =>
    candidate.source === 'intents' ? true : candidate.from.assetId === `nep141:${WRAP_NEAR}` || (evmChainOfOneClick(candidate.from.blockchain) !== null && evmFrom !== undefined && evmRpc !== undefined),
  )
  if (!leg) return NOT_YET
  const fromIntents = leg.source === 'intents'
  const evmChain = leg.source === 'wallet' ? evmChainOfOneClick(leg.from.blockchain) : null
  // A refund goes back where the deposit came from: the wallet's EVM address on that chain, or its NEAR account.
  if (fromIntents && !holdings) return { ok: false, reason: 'chain-unavailable' }
  if (fromIntents && leg.held < leg.amount) return { ok: false, reason: 'insufficient-funds' }

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
    depositType: fromIntents ? 'INTENTS' : 'ORIGIN_CHAIN',
    refundTo: evmChain && evmFrom ? evmFrom : near,
    recipient: payout,
    recipientType: route.toIntents ? 'INTENTS' : 'DESTINATION_CHAIN',
    dry: false,
    deadline: new Date(now() + PLAN_TTL_MS + SWAP_DEADLINE_AFTER_PLAN_MS),
    slippageBps: SLIPPAGE_BPS,
  }).catch((): OneClickQuoteResult => ({ ok: false, reason: 'unavailable' }))
  if (!quoted.ok) return { ok: false, reason: QUOTE_FAILURES[quoted.reason] }
  const { depositAddress, deadline } = quoted.quote
  // On NEAR the deposit goes by ft_transfer or mt_transfer, so the address must be a NEAR account; on an EVM chain an
  // address there. Either way it must outlive the plan.
  const depositOk = evmChain ? isEvmAddress(depositAddress ?? '') : isNearAccountId(depositAddress ?? '')
  if (!depositAddress || !depositOk || !deadline || deadline.getTime() < now() + PLAN_TTL_MS + SWAP_DEADLINE_MARGIN_MS) return { ok: false, reason: 'chain-unavailable' }

  const terms = {
    via: '1click' as const,
    depositAddress,
    deadline: deadline.toISOString(),
    originAsset: leg.from.assetId,
    destinationAsset: route.to.assetId,
    amountIn: leg.amount.toString(),
    amountOut: quoted.quote.amountOut.toString(),
    minAmountOut: quoted.quote.minAmountOut.toString(),
    getSymbol: route.to.symbol,
    getDecimals: String(route.to.decimals),
    getChain: route.toIntents ? 'intents' : route.to.blockchain,
    recipient: payout,
    feeBps: String(quoted.quote.feeBps),
    seconds: String(Math.round(quoted.quote.seconds)),
  }

  if (evmChain && evmFrom && evmRpc) {
    // The coin or token 1Click lists, sent from the wallet's EVM address to the deposit address there.
    const rpc = evmRpc(evmChain)
    const token = await evmTokenOf(leg.from.contract ?? evmChain.symbol, evmChain, rpc, [leg.from])
    if ('failure' in token) return { ok: false, reason: token.failure }
    const built = await buildEvmTransfer(rpc, { chainId: evmChain.chainId, from: evmFrom, to: depositAddress, ...token, amount: leg.amount })
    if (!built.ok) return built
    return {
      ok: true,
      steps: built.steps,
      swap: { ...terms, sendSymbol: token.symbol, refundTo: evmFrom, payFrom: 'evm', sendDecimals: String(token.decimals), sendChainId: String(evmChain.chainId), sendToken: token.token },
      payout: { address: payout, chain: payoutChain },
    }
  }

  const calls: NearCall[] = fromIntents
    ? [{ method: 'mt_transfer', receiverId: depositAddress, tokenId: leg.from.assetId, amount: leg.amount }]
    : [
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
    steps: [nearCallStep({ signerId: near, publicKey: nearPublicKey(hexToBytes(near)), receiverId: fromIntents ? INTENTS_NEAR : WRAP_NEAR, calls })],
    swap: {
      ...terms,
      sendSymbol: fromIntents ? leg.from.symbol : 'NEAR',
      refundTo: near,
      ...(fromIntents ? { payFrom: 'intents' as const, sendDecimals: String(leg.from.decimals) } : {}),
    },
    payout: { address: payout, chain: payoutChain },
  }
}
