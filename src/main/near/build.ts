import { hexToBytes } from '@noble/hashes/utils.js'
import type { Account } from '../../shared/accounts'
import { nearAccountKind } from '../../shared/near/account-id'
import { nearPublicKey, nearTransferStep } from '../../shared/near/transaction'
import { parseNear } from '../../shared/near/units'
import type { PlanFailure, PlanIntent, PlanStep } from '../../shared/plan'
import { storageHeld } from './balance'
import { NearRpcError, type NearProtocolFees, type NearRpc } from './rpc'

/**
 * Room for the gas price to rise between building a plan and sending it. NEAR
 * moves it by at most 1% a block, so doubling covers about a minute of full
 * blocks in a row. Unused gas comes back, so the margin costs nothing.
 */
export const GAS_PRICE_MARGIN = 2n

/**
 * The most a transfer's fees can cost, yoctoNEAR. Every fee is counted as sent
 * and executed, all at the higher of the gas price and the price receipts are
 * bought at, doubled. A transfer that creates an implicit account also pays
 * for creating it and its key, plus the account creation charge.
 */
export function transferFeeCeiling(fees: NearProtocolFees, gasPrice: bigint, createsAccount: boolean): bigint {
  const parts = createsAccount ? [fees.receipt, fees.transfer, fees.createAccount, fees.addFullAccessKey] : [fees.receipt, fees.transfer]
  const gas = parts.reduce((sum, part) => sum + part.send + part.exec, 0n)
  const price = (gasPrice > fees.minGasPurchasePrice ? gasPrice : fees.minGasPurchasePrice) * GAS_PRICE_MARGIN
  return gas * price + (createsAccount ? fees.accountCreationCharge : 0n)
}

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
 * - the balance covers the amount and the most the fees could cost, creating the recipient included when it doesn't exist yet.
 */
export async function buildNearSend(intent: PlanIntent, own: readonly Account[], rpc: NearRpc): Promise<StepsResult> {
  const from = own.find((account) => account.chain === 'near')?.address
  const deposit = parseNear(intent.amount)
  const to = intent.to ?? ''
  const kind = nearAccountKind(to)
  if (!from || nearAccountKind(from) !== 'implicit') return { ok: false, reason: 'chain-unavailable' }
  if (deposit === null || deposit === 0n || kind === null) return { ok: false, reason: 'bad-request' }

  try {
    const [sender, receiver, gasPrice, fees] = await Promise.all([rpc.viewAccount(from), rpc.viewAccount(to), rpc.gasPrice(), rpc.protocolFees()])
    if (kind === 'named' && receiver === null) return { ok: false, reason: 'recipient-unknown' }
    const available = sender ? sender.amount - storageHeld(sender) : 0n
    if (available < deposit + transferFeeCeiling(fees, gasPrice, receiver === null)) return { ok: false, reason: 'insufficient-funds' }
  } catch (error) {
    if (error instanceof NearRpcError) return { ok: false, reason: 'chain-unavailable' }
    throw error
  }

  return { ok: true, steps: [nearTransferStep({ signerId: from, publicKey: nearPublicKey(hexToBytes(from)), receiverId: to, deposit: deposit.toString() })] }
}
