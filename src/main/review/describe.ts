import { nearAccountKind } from '../../shared/near/account-id'
import { nearPublicKey } from '../../shared/near/transaction'
import { formatNear } from '../../shared/near/units'
import type { ReviewPlan } from '../../shared/review'
import { nearTransferOf } from '../near/build'
import type { PlanView } from '../plans/store'

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
  const transfer = nearTransferOf(plan.core)
  const toKind = transfer ? nearAccountKind(transfer.receiverId) : null
  const recipient = plan.core.recipient
  // A plan whose recipient isn't the one its step pays isn't one main made, so it isn't shown.
  if (!transfer || !toKind || !recipient || recipient.address !== transfer.receiverId) return null
  const amount = formatNear(transfer.deposit)
  return {
    id: plan.id,
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
    actions: [{ kind: 'Transfer', amount, method: null }],
    expiresAt: plan.core.expiresAt,
  }
}
