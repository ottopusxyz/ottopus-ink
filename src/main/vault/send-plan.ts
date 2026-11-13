import { bytesToHex } from '@noble/hashes/utils.js'
import type { PlanFailure, PlanStatus } from '../../shared/plan'
import type { VaultFailure } from '../../shared/vault'
import { callsDeposit, callsGas, callsOfStep } from '../../shared/near/calls'
import { NearDecodeError } from '../../shared/near/transaction'
import type { PlanCore } from '../../shared/plan'
import { nearCallsFit, nearSendFits, nearTransferOf } from '../near/build'
import { NearRpcError, type NearRpc } from '../near/rpc'
import type { PlanStore, PlanView } from '../plans/store'
import { evmChainById, type EvmChain } from '../../shared/evm/chains'
import { EvmDecodeError, evmTransferOfStep } from '../../shared/evm/transaction'
import { evmSendFees, evmSendFits } from '../evm/build'
import { EvmRpcError, type EvmRpc } from '../evm/rpc'
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
  /** The fees could now cost more than the most the person was shown when they approved. */
  | 'fee-rose'
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
  /** Each EVM chain's RPC, for plans that send on one. */
  evmRpc?: (chain: EvmChain) => EvmRpc
  /** Told of each plan its chain ran, with its transaction, so a swap can be followed from there. */
  onConfirmed?: (plan: PlanView, transactionId: string) => void
  now?: () => number
  wait?: (ms: number) => Promise<void>
}

/** How long a send waits for its EVM transaction's receipt before leaving it submitted for the chain to decide. */
export const EVM_RECEIPT_WAIT_MS = 3 * 60_000
const EVM_RECEIPT_POLL_MS = 2_000

/**
 * How long before a swap's deposit address dies Ink stops sending to it: time for the
 * transaction to land and for 1Click to see it.
 */
export const SWAP_SEND_MARGIN_MS = 5 * 60_000

type Fit = 'recipient-unknown' | 'insufficient-funds' | 'fee-rose' | null

/** What a plan's one step sends: from whom, with which key, and whether it still fits. Null for a plan Ink can't send. */
function sendableOf(core: PlanCore): { signerId: string; publicKey: string; fits: (rpc: NearRpc, maxFee: bigint) => Promise<Fit> } | null {
  const transfer = nearTransferOf(core)
  const [step, ...rest] = core.steps
  if (transfer && step) {
    return { signerId: transfer.signerId, publicKey: step.fields.publicKey as string, fits: (rpc, maxFee) => nearSendFits(rpc, transfer.signerId, transfer.receiverId, transfer.deposit, maxFee) }
  }
  if (!step || rest.length > 0 || step.action !== 'call') return null
  try {
    const { signerId, calls } = callsOfStep(step)
    return { signerId, publicKey: step.fields.publicKey as string, fits: (rpc, maxFee) => nearCallsFit(rpc, signerId, callsDeposit(calls), callsGas(calls), calls.length, maxFee) }
  } catch (error) {
    if (error instanceof NearDecodeError) return null
    throw error
  }
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
export function createPlanSender({ store, vault, rpc, evmRpc, onConfirmed, now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }: PlanSenderOptions) {
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

  async function run(id: string, owner: string, maxFee: bigint): Promise<SendResult> {
    const plan = store.get(id, owner)
    if (!plan) return { ok: false, reason: 'not-found' }
    if (plan.status !== 'approved') return { ok: false, reason: 'cannot-move', status: plan.status }
    // A swap's deposit address must still be alive when the deposit lands, with time to spare.
    const swap = plan.core.swap
    if (swap && !(now() < Date.parse(swap.deadline) - SWAP_SEND_MARGIN_MS)) return { ok: false, reason: 'cannot-move', status: plan.status }
    if (plan.core.steps[0]?.chain === 'evm') return runEvm(plan, owner, maxFee)
    const sendable = sendableOf(plan.core)
    if (!sendable) return { ok: false, reason: 'bad-request', status: plan.status }

    const { signerId, publicKey } = sendable
    const keyId = `${signerId} ${publicKey}`
    let live: { nonce: string; blockHash: string }
    let blockHeight: bigint
    try {
      if ((await rpc.chainId()) !== NEAR_NETWORK) return { ok: false, reason: 'wrong-network', status: plan.status }
      const unfit = await sendable.fits(rpc, maxFee)
      if (unfit) return { ok: false, reason: unfit, status: plan.status }
      const key = await rpc.viewAccessKey(signerId, publicKey)
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
      if (done.ok && done.plan.status === 'confirmed') onConfirmed?.(done.plan, step.transactionId)
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

  /** The highest nonce signed on each EVM chain for each address, so two plans never share one. */
  const evmNonces = new Map<string, bigint>()

  /**
   * An EVM plan's one transfer, the same way: checks the chain, the balance and today's fees
   * against what was approved while the plan is still approved, reads the next nonce, has
   * the signer sign it, sends it, and waits a while for its receipt. A send with no answer,
   * or no receipt yet, stays submitted for the chain to decide.
   */
  async function runEvm(plan: PlanView, owner: string, maxFee: bigint): Promise<SendResult> {
    const id = plan.id
    const [step, ...rest] = plan.core.steps
    let transfer: ReturnType<typeof evmTransferOfStep>
    try {
      if (!step || rest.length > 0) throw new EvmDecodeError('one step')
      transfer = evmTransferOfStep(step)
    } catch (error) {
      if (error instanceof EvmDecodeError) return { ok: false, reason: 'bad-request', status: plan.status }
      throw error
    }
    const chain = evmChainById(transfer.chainId)
    if (!chain || !evmRpc) return { ok: false, reason: 'chain-unavailable', status: plan.status }
    const chainRpc = evmRpc(chain)
    const keyId = `evm ${chain.chainId} ${transfer.from.toLowerCase()}`
    let live: { nonce: string; maxFeePerGas: string; maxPriorityFeePerGas: string }
    try {
      const fees = await evmSendFees(chainRpc, transfer.gas)
      const unfit = await evmSendFits(chainRpc, transfer, fees.ceiling, maxFee)
      if (unfit) return { ok: false, reason: unfit, status: plan.status }
      const pending = await chainRpc.nonce(transfer.from)
      const lastSigned = evmNonces.get(keyId)
      // A transaction signed here that the chain doesn't show yet: a new one would wait behind it, or be stuck if it never lands.
      if (lastSigned !== undefined && lastSigned >= pending) return { ok: false, reason: 'earlier-pending', status: plan.status }
      live = { nonce: pending.toString(), maxFeePerGas: fees.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString() }
    } catch (error) {
      if (error instanceof EvmRpcError) return { ok: false, reason: 'chain-unavailable', status: plan.status }
      throw error
    }

    const signing = store.move(id, owner, 'signing')
    if (!signing.ok) return signing
    const signed = await vault.sign(plan.core, plan.hash, [live])
    if (!signed.ok) {
      const reason = signed.reason === 'locked' || signed.reason === 'plan-mismatch' || signed.reason === 'refused' || signed.reason === 'signer-stopped' ? signed.reason : 'refused'
      return fail(id, owner, reason)
    }
    const [signedStep] = signed.signed
    if (!signedStep || signed.signed.length !== 1) return fail(id, owner, 'refused')
    evmNonces.set(keyId, BigInt(live.nonce))

    const submitted = store.move(id, owner, 'submitted')
    if (!submitted.ok) return submitted
    const hash = signedStep.transactionId
    try {
      await chainRpc.send(signedStep.signed)
    } catch (error) {
      if (!(error instanceof EvmRpcError)) throw error
      if (error.reason === 'rejected') {
        // Turned away before it ran: it spent nothing, and its nonce is free again.
        evmNonces.delete(keyId)
        const failed = store.move(id, owner, 'failed')
        return failed.ok ? { ok: true, plan: failed.plan, transactionId: hash } : failed
      }
      return { ok: true, plan: submitted.plan, transactionId: hash }
    }
    for (const started = now(); now() - started < EVM_RECEIPT_WAIT_MS; ) {
      const receipt = await chainRpc.receipt(hash).catch(() => null)
      if (receipt) {
        const done = store.move(id, owner, receipt.ok ? 'confirmed' : 'failed')
        if (done.ok && done.plan.status === 'confirmed') onConfirmed?.(done.plan, hash)
        return done.ok ? { ok: true, plan: done.plan, transactionId: hash } : done
      }
      await wait(EVM_RECEIPT_POLL_MS)
    }
    return { ok: true, plan: submitted.plan, transactionId: hash }
  }

  return {
    /**
     * Sends the plan, if the fees can't cost more than `maxFee`, the most the person was shown
     * when they approved: in yoctoNEAR for NEAR, in the chain's wei for an EVM chain.
     */
    async send(id: string, owner: string, maxFee: bigint): Promise<SendResult> {
      if (sending) return { ok: false, reason: 'busy' }
      sending = true
      try {
        return await run(id, owner, maxFee)
      } finally {
        sending = false
      }
    },
  }
}

export type PlanSender = ReturnType<typeof createPlanSender>
