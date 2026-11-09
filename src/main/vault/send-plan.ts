import { bytesToHex } from '@noble/hashes/utils.js'
import type { PlanFailure, PlanStatus } from '../../shared/plan'
import type { VaultFailure } from '../../shared/vault'
import { nearSendFits, nearTransferOf } from '../near/build'
import { NearRpcError, type NearRpc } from '../near/rpc'
import type { PlanStore, PlanView } from '../plans/store'
import type { VaultService } from './service'

/** The only network Ink sends on. */
export const NEAR_NETWORK = 'mainnet'

export type SendFailure =
  | PlanFailure
  | Extract<VaultFailure, 'locked' | 'plan-mismatch' | 'refused' | 'signer-stopped'>
  /** Another plan is being signed or sent, and two at once could take the same nonce. */
  | 'busy'
  /** The RPC is on another NEAR network, so a transaction built from its answers could spend there. */
  | 'wrong-network'
  /**
   * An earlier send from this key got no answer and may still land. A later
   * transaction reaching the chain first would raise the key's nonce past it,
   * and the earlier one could then never land, so the later one waits.
   */
  | 'earlier-pending'

export type SendResult =
  | { ok: true; plan: PlanView; transactionId: string }
  | { ok: false; reason: SendFailure; status?: PlanStatus }

export interface PlanSenderOptions {
  store: PlanStore
  vault: Pick<VaultService, 'sign'>
  rpc: NearRpc
}

/**
 * Blocks a transaction's block hash stays valid for: mainnet's genesis
 * `transaction_validity_period`. A transaction built on an older block can
 * never land.
 */
export const TRANSACTION_VALIDITY_BLOCKS = 86_400n

/**
 * Takes a plan the person approved through signing to the chain:
 * 1. checks, while the plan is still approved, that the RPC is on mainnet and
 *    that the send still fits the balance and today's fees, and reads the
 *    key's nonce and a recent block, so nothing that fails here costs the
 *    person their approval;
 * 2. moves it to signing, and has the signer sign it under the approved hash;
 * 3. moves it to submitted, sends it, and moves it to confirmed or failed by
 *    NEAR's final outcome.
 *
 * A send whose answer doesn't come back stays submitted: it may still go
 * through, and only the chain can say. Until the chain shows it can't land any
 * more (it landed, its nonce was used, or its block is too old), the key sends
 * nothing else, so a later send can't overtake it. One plan at a time, each
 * signed above every nonce already signed with its key, so no two share one.
 */
export function createPlanSender({ store, vault, rpc }: PlanSenderOptions) {
  let sending = false
  /**
   * The highest nonce signed with each key. A send that got no answer, or that
   * a lagging RPC doesn't show yet, still holds its nonce, so the next plan
   * signs above it. NEAR only needs a nonce above the key's last one, so a gap
   * left by a send that never lands does no harm.
   */
  const signedNonces = new Map<string, bigint>()
  /** For each key, a send that got no answer: its nonce, and the height of the block it was built on. */
  const unanswered = new Map<string, { nonce: bigint; blockHeight: bigint }>()

  const fail = (id: string, owner: string, reason: SendFailure): SendResult => {
    const moved = store.move(id, owner, 'failed')
    return { ok: false, reason, status: moved.ok ? moved.plan.status : undefined }
  }

  async function run(id: string, owner: string): Promise<SendResult> {
    const plan = store.get(id, owner)
    if (!plan) return { ok: false, reason: 'not-found' }
    if (plan.status !== 'approved') return { ok: false, reason: 'cannot-move', status: plan.status }
    const transfer = nearTransferOf(plan.core)
    if (!transfer) return { ok: false, reason: 'bad-request', status: plan.status }

    const publicKey = plan.core.steps[0]?.fields.publicKey as string
    const keyId = `${transfer.signerId} ${publicKey}`
    let live: { nonce: string; blockHash: string }
    let blockHeight: bigint
    try {
      if ((await rpc.chainId()) !== NEAR_NETWORK) return { ok: false, reason: 'wrong-network', status: plan.status }
      const unfit = await nearSendFits(rpc, transfer.signerId, transfer.receiverId, transfer.deposit)
      if (unfit) return { ok: false, reason: unfit, status: plan.status }
      const key = await rpc.viewAccessKey(transfer.signerId, publicKey)
      // No key means no account yet: nothing has been sent to it, so there is nothing to spend.
      if (!key) return { ok: false, reason: 'insufficient-funds', status: plan.status }
      const earlier = unanswered.get(keyId)
      if (earlier) {
        // Landed or taken by another transaction once the key's nonce reaches it, and dead once its block is too old.
        const settled = key.nonce >= earlier.nonce || key.blockHeight > earlier.blockHeight + TRANSACTION_VALIDITY_BLOCKS
        if (!settled) return { ok: false, reason: 'earlier-pending', status: plan.status }
        unanswered.delete(keyId)
      }
      blockHeight = key.blockHeight
      const lastSigned = signedNonces.get(keyId) ?? 0n
      live = { nonce: ((key.nonce > lastSigned ? key.nonce : lastSigned) + 1n).toString(), blockHash: bytesToHex(key.blockHash) }
    } catch (error) {
      if (error instanceof NearRpcError) return { ok: false, reason: 'chain-unavailable', status: plan.status }
      throw error
    }

    // It may have been cancelled or expired while the chain was asked.
    const signing = store.move(id, owner, 'signing')
    if (!signing.ok) return signing
    const signed = await vault.sign(plan.core, plan.hash, [live])
    if (!signed.ok) {
      const reason = signed.reason === 'locked' || signed.reason === 'plan-mismatch' || signed.reason === 'refused' || signed.reason === 'signer-stopped' ? signed.reason : 'refused'
      return fail(id, owner, reason)
    }
    const [step] = signed.signed
    if (!step || signed.signed.length !== 1) return fail(id, owner, 'refused')
    // From here a transaction with this nonce exists, whatever becomes of it.
    signedNonces.set(keyId, BigInt(live.nonce))

    const submitted = store.move(id, owner, 'submitted')
    if (!submitted.ok) return submitted
    try {
      const outcome = await rpc.sendTransaction(step.signed)
      const done = store.move(id, owner, outcome.ok ? 'confirmed' : 'failed')
      return done.ok ? { ok: true, plan: done.plan, transactionId: step.transactionId } : done
    } catch (error) {
      if (!(error instanceof NearRpcError)) throw error
      // NEAR turned the transaction away, so it never ran and spent nothing.
      if (error.reason === 'rejected') {
        const failed = store.move(id, owner, 'failed')
        return failed.ok ? { ok: true, plan: failed.plan, transactionId: step.transactionId } : failed
      }
      // No answer: it may still land, so it stays submitted for the chain to decide.
      unanswered.set(keyId, { nonce: BigInt(live.nonce), blockHeight })
      return { ok: true, plan: submitted.plan, transactionId: step.transactionId }
    }
  }

  return {
    async send(id: string, owner: string): Promise<SendResult> {
      if (sending) return { ok: false, reason: 'busy' }
      sending = true
      try {
        return await run(id, owner)
      } finally {
        sending = false
      }
    },
  }
}

export type PlanSender = ReturnType<typeof createPlanSender>
