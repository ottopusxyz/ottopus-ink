import { hexToBytes } from '@noble/hashes/utils.js'
import type { Account } from '../../shared/accounts'
import { nearAccountKind } from '../../shared/near/account-id'
import { nearPublicKey, nearTransferStep } from '../../shared/near/transaction'
import { parseNear } from '../../shared/near/units'
import type { PlanFailure, PlanIntent, PlanStep } from '../../shared/plan'
import { storageHeld } from './balance'
import { NearRpcError, type NearRpc } from './rpc'

/**
 * Gas a transfer may burn, with room to spare: about 0.45 Tgas to an existing
 * account and about 0.85 Tgas when it creates an implicit one, before NEAR's
 * pessimistic pricing of receipts. Unused gas comes back.
 */
export const TRANSFER_GAS_CEILING = 2_000_000_000_000n

export type StepsResult = { ok: true; steps: PlanStep[] } | { ok: false; reason: PlanFailure }

/** Whether the intent is a send of native NEAR on NEAR, the one thing this module builds. */
export const isNearSend = (intent: PlanIntent): boolean =>
  intent.outcome === 'send' && intent.chain?.toLowerCase() === 'near' && intent.asset.toUpperCase() === 'NEAR'

/**
 * The step for sending NEAR from the person's own account: their implicit
 * account, its key, and the exact deposit. It checks what NEAR would refuse
 * later, so a plan that can't go through is never made:
 * - the amount is exact in yoctoNEAR;
 * - the recipient is a NEAR account id, and a named one already exists (only implicit accounts are created by a transfer);
 * - the balance covers the amount and the most the gas could cost.
 */
export async function buildNearSend(intent: PlanIntent, own: readonly Account[], rpc: NearRpc): Promise<StepsResult> {
  const from = own.find((account) => account.chain === 'near')?.address
  const deposit = parseNear(intent.amount)
  const to = intent.to ?? ''
  const kind = nearAccountKind(to)
  if (!from || nearAccountKind(from) !== 'implicit') return { ok: false, reason: 'chain-unavailable' }
  if (deposit === null || deposit === 0n || kind === null) return { ok: false, reason: 'bad-request' }

  try {
    const [sender, receiver, gasPrice] = await Promise.all([rpc.viewAccount(from), kind === 'named' ? rpc.viewAccount(to) : null, rpc.gasPrice()])
    if (kind === 'named' && receiver === null) return { ok: false, reason: 'recipient-unknown' }
    const available = sender ? sender.amount - storageHeld(sender) : 0n
    if (available < deposit + gasPrice * TRANSFER_GAS_CEILING) return { ok: false, reason: 'insufficient-funds' }
  } catch (error) {
    if (error instanceof NearRpcError) return { ok: false, reason: 'chain-unavailable' }
    throw error
  }

  return { ok: true, steps: [nearTransferStep({ signerId: from, publicKey: nearPublicKey(hexToBytes(from)), receiverId: to, deposit: deposit.toString() })] }
}
