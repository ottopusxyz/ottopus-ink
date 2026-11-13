import { nearAccountKind } from '../../shared/near/account-id'
import { CALL_RULES, callsDeposit, callsOfStep, describeCall, INTENTS_NEAR, WRAP_NEAR } from '../../shared/near/calls'
import { NearDecodeError, nearPublicKey } from '../../shared/near/transaction'
import { formatNear } from '../../shared/near/units'
import type { PlanSwap } from '../../shared/plan'
import type { ReviewPlan } from '../../shared/review'
import { formatUnits } from '../../shared/token-text'
import { nearTransferOf } from '../near/build'
import type { PlanView } from '../plans/store'
import { chainName } from '../routes/route'
import { swapSent } from '../routes/swap-terms'

/**
 * What the review window shows for a plan, worked out from its fixed steps: the
 * same fields the signer reads back and signs. Nothing comes from the intent or
 * summary, which began as the agent's words. Null for a plan Ink can't send, so
 * it's never shown for approval.
 *
 * `maxFee` is the most the fees could take, in yoctoNEAR, or null if the chain
 * couldn't be asked. It's only shown: the sender checks the balance against it
 * again just before signing.
 */
export function describeForReview(plan: PlanView, network: string, maxFee: bigint | null): ReviewPlan | null {
  if (plan.core.swap) return describeSwap(plan, network, maxFee)
  const transfer = nearTransferOf(plan.core)
  const toKind = transfer ? nearAccountKind(transfer.receiverId) : null
  const recipient = plan.core.recipient
  // A plan whose recipient isn't the one its step pays isn't one main made, so it isn't shown.
  if (!transfer || !toKind || !recipient || recipient.address !== transfer.receiverId) return null
  const amount = formatNear(transfer.deposit)
  return {
    id: plan.id,
    kind: 'send',
    swap: null,
    hash: plan.hash,
    network,
    from: transfer.signerId,
    publicKey: nearPublicKey(transfer.publicKey),
    to: transfer.receiverId,
    toKind,
    toWhy: recipient.why,
    amount,
    amountYocto: transfer.deposit.toString(),
    asset: 'NEAR',
    maxFee: maxFee === null ? null : formatNear(maxFee),
    maxFeeYocto: maxFee === null ? null : maxFee.toString(),
    maxTotal: maxFee === null ? null : formatNear(transfer.deposit + maxFee),
    actions: [{ kind: 'Transfer', amount, method: null, summary: `Send ${amount} NEAR to ${transfer.receiverId}` }],
    expiresAt: plan.core.expiresAt,
  }
}

/** A token amount from its smallest unit and decimals, or null if either isn't one. */
function tokenAmount(raw: string, decimals: string, symbol: string): string | null {
  if (!/^(0|[1-9][0-9]*)$/.test(raw) || !/^[0-9]{1,2}$/.test(decimals)) return null
  return `${formatUnits(BigInt(raw), Number(decimals))} ${symbol}`
}

/**
 * A swap's review, from its one step of calls and the terms 1Click fixed. It's shown only
 * when the two agree: paid from the wallet, the step wraps exactly the NEAR swapped and
 * sends it all to the deposit address; paid from the Intents balance, it moves exactly
 * the token swapped, and nothing else, to the deposit address. Either way 1Click pays the
 * plan's own recipient (the person's, or one they typed) and refunds the person's own
 * account.
 */
function describeSwap(plan: PlanView, network: string, maxFee: bigint | null): ReviewPlan | null {
  const swap = plan.core.swap as PlanSwap
  const [step, ...rest] = plan.core.steps
  const recipient = plan.core.recipient
  if (!step || rest.length > 0 || !recipient || recipient.address !== swap.recipient) return null
  let read: ReturnType<typeof callsOfStep>
  try {
    read = callsOfStep(step)
  } catch (error) {
    if (error instanceof NearDecodeError) return null
    throw error
  }
  const amountIn = /^[1-9][0-9]*$/.test(swap.amountIn) ? BigInt(swap.amountIn) : null
  const sent = swapSent(swap)
  if (amountIn === null || !sent || swap.refundTo !== read.signerId) return null
  if (swap.payFrom === 'intents') {
    const [move, ...others] = read.calls
    if (read.receiverId !== INTENTS_NEAR || others.length > 0 || move?.method !== 'mt_transfer' || move.receiverId !== swap.depositAddress || move.tokenId !== swap.originAsset || move.amount !== amountIn) return null
  } else {
    const wraps = read.calls.filter((call) => call.method === 'near_deposit')
    const sends = read.calls.filter((call) => call.method === 'ft_transfer')
    const pays = (call: (typeof read.calls)[number]) => call.method === 'ft_transfer' && call.receiverId === swap.depositAddress && call.amount === amountIn
    if (read.receiverId !== WRAP_NEAR || swap.sendSymbol !== 'NEAR' || wraps.length !== 1 || wraps[0]?.amount !== amountIn || sends.length !== 1 || !pays(sends[0]!)) return null
  }

  const get = tokenAmount(swap.amountOut, swap.getDecimals, swap.getSymbol)
  const least = tokenAmount(swap.minAmountOut, swap.getDecimals, swap.getSymbol)
  const seconds = Number(swap.seconds)
  const feeBps = Number(swap.feeBps)
  if (!get || !least || !Number.isFinite(seconds) || !Number.isInteger(feeBps)) return null
  const deposit = callsDeposit(read.calls)
  const fromIntents = swap.payFrom === 'intents'
  // What leaves, as the amount line reads it: NEAR from the wallet, or the token from the Intents balance.
  const amount = fromIntents ? sent.slice(0, sent.lastIndexOf(' ')) : formatNear(amountIn)
  const toKind = swap.getChain === 'intents' ? nearAccountKind(swap.recipient) : 'other-chain'
  if (!toKind) return null
  return {
    id: plan.id,
    kind: 'swap',
    swap: {
      send: sent,
      from: fromIntents ? 'intents' : 'wallet',
      get,
      least,
      getChain: swap.getChain === 'intents' ? 'your NEAR Intents balance' : chainName(swap.getChain),
      refundTo: swap.refundTo,
      depositAddress: swap.depositAddress,
      deadline: swap.deadline,
      fee: `${(feeBps / 100).toFixed(2).replace(/\.?0+$/, '')}%`,
      seconds,
    },
    hash: plan.hash,
    network,
    from: read.signerId,
    publicKey: nearPublicKey(read.publicKey),
    to: swap.recipient,
    toKind,
    toWhy: recipient.why,
    amount,
    amountYocto: amountIn.toString(),
    asset: fromIntents ? swap.sendSymbol : 'NEAR',
    maxFee: maxFee === null ? null : formatNear(maxFee),
    maxFeeYocto: maxFee === null ? null : maxFee.toString(),
    // The NEAR that can leave the account: for a swap from the Intents balance, the yoctoNEAR the move attaches and the fee.
    maxTotal: maxFee === null ? null : formatNear(deposit + maxFee),
    actions: read.calls.map((call) => ({
      kind: 'FunctionCall',
      amount: formatNear(CALL_RULES[call.method].deposit(call)),
      method: call.method,
      // The move's token and amount checked against the swap's own above, so they can be written as a person reads them.
      summary: call.method === 'mt_transfer' ? `Move ${sent} from your NEAR Intents balance to NEAR Intents’ deposit address ${call.receiverId}` : describeCall(call, read.receiverId),
    })),
    expiresAt: plan.core.expiresAt,
  }
}
