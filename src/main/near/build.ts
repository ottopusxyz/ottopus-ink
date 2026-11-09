import { hexToBytes } from '@noble/hashes/utils.js'
import type { Account } from '../../shared/accounts'
import { nearAccountKind, type NearAccountKind } from '../../shared/near/account-id'
import { NearDecodeError, nearPublicKey, nearTransferStep, transferOfStep, type NearTransfer } from '../../shared/near/transaction'
import { parseNear } from '../../shared/near/units'
import type { PlanCore, PlanFailure, PlanIntent, PlanStep } from '../../shared/plan'
import { storageHeld } from './balance'
import { NearRpcError, type NearProtocolFees, type NearRpc } from './rpc'

/**
 * Room for the gas price to rise between building a plan and sending it. NEAR
 * moves it by at most 1% a block, so doubling covers about a minute of full
 * blocks in a row. Unused gas comes back, so the margin costs nothing.
 */
export const GAS_PRICE_MARGIN = 2n

/**
 * The most a transfer can take from the sender up front, yoctoNEAR, worked out
 * as nearcore's `calculate_tx_cost` does:
 * - the send fees are burnt at the gas price;
 * - the exec fees are bought at the higher of the gas price and the minimum
 *   price receipts are bought at, and what isn't burnt comes back.
 * Which fees a transfer pays depends on the receiver's kind of account id, not
 * on whether it exists (nearcore's `transfer_send_fee` and `transfer_exec_fee`):
 * to a NEAR implicit account it pays for creating the account and its full
 * access key, to an Ethereum implicit one for creating the account. NEAR's
 * account creation charge comes out of the refund, so it isn't added here.
 */
export function transferFeeCeiling(fees: NearProtocolFees, gasPrice: bigint, receiver: NearAccountKind): bigint {
  const parts = [fees.receipt, fees.transfer]
  if (receiver !== 'named') parts.push(fees.createAccount)
  if (receiver === 'implicit') parts.push(fees.addFullAccessKey)
  const send = parts.reduce((sum, part) => sum + part.send, 0n)
  const exec = parts.reduce((sum, part) => sum + part.exec, 0n)
  const price = gasPrice * GAS_PRICE_MARGIN
  const receiptPrice = price > fees.minGasPurchasePrice ? price : fees.minGasPurchasePrice
  return send * price + exec * receiptPrice
}

/** Placeholders that only let a step be read: the real nonce and block hash come from the chain when it's signed. */
const READ_ONLY = { nonce: 1n, blockHash: new Uint8Array(32) }

/** The one kind of plan Ink can send so far: a single NEAR transfer. Null for anything else. */
export function nearTransferOf(core: PlanCore): NearTransfer | null {
  const [step, ...rest] = core.steps
  if (!step || rest.length > 0) return null
  try {
    return transferOfStep(step, READ_ONLY)
  } catch (error) {
    if (error instanceof NearDecodeError) return null
    throw error
  }
}

/** The most the fees for a transfer to this account could take up front, at today's gas price. Throws `NearRpcError`. */
export async function nearSendFeeCeiling(rpc: NearRpc, to: string): Promise<bigint> {
  const kind = nearAccountKind(to)
  if (kind === null) throw new NearDecodeError('not a NEAR account id')
  const [gasPrice, fees] = await Promise.all([rpc.gasPrice(), rpc.protocolFees()])
  return transferFeeCeiling(fees, gasPrice, kind)
}

export type StepsResult = { ok: true; steps: PlanStep[] } | { ok: false; reason: PlanFailure }

/** Whether the intent is a send of native NEAR on NEAR, the one thing this module builds. */
export const isNearSend = (intent: PlanIntent): boolean =>
  intent.outcome === 'send' && intent.chain?.toLowerCase() === 'near' && intent.asset.toUpperCase() === 'NEAR'

/**
 * Whether NEAR would take this send now: a named recipient exists (only
 * implicit accounts are created by a transfer), and the sender's balance covers
 * the deposit and the most the fees could take up front at today's gas price.
 * Checked when a plan is made and again just before it's signed, since the
 * balance and gas price may have moved in between. Throws `NearRpcError`.
 */
export async function nearSendFits(rpc: NearRpc, from: string, to: string, deposit: bigint): Promise<'recipient-unknown' | 'insufficient-funds' | null> {
  const kind = nearAccountKind(to)
  if (kind === null) return 'recipient-unknown'
  const [sender, receiver, gasPrice, fees] = await Promise.all([rpc.viewAccount(from), kind === 'named' ? rpc.viewAccount(to) : null, rpc.gasPrice(), rpc.protocolFees()])
  if (kind === 'named' && receiver === null) return 'recipient-unknown'
  const available = sender ? sender.amount - storageHeld(sender) : 0n
  return available < deposit + transferFeeCeiling(fees, gasPrice, kind) ? 'insufficient-funds' : null
}

/**
 * The step for sending NEAR from the person's own account: their implicit
 * account, its key, and the exact deposit. It checks what NEAR would refuse
 * later, so a plan that can't go through is never made: the amount is exact in
 * yoctoNEAR, the recipient is a NEAR account id, and the send fits.
 */
export async function buildNearSend(intent: PlanIntent, own: readonly Account[], rpc: NearRpc): Promise<StepsResult> {
  const from = own.find((account) => account.chain === 'near')?.address
  const deposit = parseNear(intent.amount)
  const to = intent.to ?? ''
  if (!from || nearAccountKind(from) !== 'implicit') return { ok: false, reason: 'chain-unavailable' }
  if (deposit === null || deposit === 0n || nearAccountKind(to) === null) return { ok: false, reason: 'bad-request' }

  try {
    const unfit = await nearSendFits(rpc, from, to, deposit)
    if (unfit) return { ok: false, reason: unfit }
  } catch (error) {
    if (error instanceof NearRpcError) return { ok: false, reason: 'chain-unavailable' }
    throw error
  }

  return { ok: true, steps: [nearTransferStep({ signerId: from, publicKey: nearPublicKey(hexToBytes(from)), receiverId: to, deposit: deposit.toString() })] }
}
