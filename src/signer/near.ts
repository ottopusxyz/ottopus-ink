import { bytesToHex } from '@noble/hashes/utils.js'
import { ACCOUNT_PATHS } from '../shared/accounts'
import { actionsOfCalls, callsOfStep, callsOfTransaction, sameCalls } from '../shared/near/calls'
import { decodeTransaction, decodeTransfer, encodeSignedTransaction, encodeTransaction, encodeTransfer, NearDecodeError, transactionHash, transactionId, transferOfStep } from '../shared/near/transaction'
import type { PlanStep } from '../shared/plan'
import { ed25519PublicKey, ed25519Sign } from './slip10'

export interface SignedNearTransfer {
  /** The signed transaction, as `send_tx` takes it. */
  signed: Uint8Array
  /** The transaction's id, base58 of its hash. */
  transactionId: string
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i])

/**
 * Signs a plan's NEAR transfer step with the seed's own NEAR key. It encodes the
 * transfer itself, decodes those bytes again and refuses unless they say
 * exactly what the step says, and refuses unless the step spends from this
 * seed's own implicit account with its own key. So nothing is signed that the
 * signer didn't build and read back itself.
 *
 * The nonce and block hash are the live values fetched just before signing.
 * Checking the plan's hash against the approved plan is the caller's job.
 */
export function signNearTransfer(seed: Uint8Array, step: PlanStep, live: { nonce: bigint; blockHash: Uint8Array }): SignedNearTransfer {
  const transfer = transferOfStep(step, live)
  const ownKey = ownNearKey(seed, transfer)

  const bytes = encodeTransfer(transfer)
  const read = decodeTransfer(bytes)
  const agrees =
    read.signerId === transfer.signerId &&
    read.receiverId === transfer.receiverId &&
    read.deposit === transfer.deposit &&
    read.nonce === transfer.nonce &&
    same(read.publicKey, transfer.publicKey) &&
    same(read.blockHash, transfer.blockHash)
  if (!agrees) throw new NearDecodeError('the encoded transaction does not read back as the step')

  return signBytes(seed, ownKey, bytes)
}

/** The seed's own NEAR key, refusing a step that spends from any other account or key. */
function ownNearKey(seed: Uint8Array, { signerId, publicKey }: { signerId: string; publicKey: Uint8Array }): Uint8Array {
  const ownKey = ed25519PublicKey(seed, ACCOUNT_PATHS.near)
  if (!same(publicKey, ownKey) || signerId !== bytesToHex(ownKey)) throw new NearDecodeError('the step spends from an account this seed does not hold')
  return ownKey
}

function signBytes(seed: Uint8Array, ownKey: Uint8Array, bytes: Uint8Array): SignedNearTransfer {
  const { publicKey, signature } = ed25519Sign(seed, ACCOUNT_PATHS.near, transactionHash(bytes))
  if (!same(publicKey, ownKey)) throw new NearDecodeError('the signing key changed')
  return { signed: encodeSignedTransaction(bytes, signature), transactionId: transactionId(bytes) }
}

/**
 * Signs a plan's step of NEAR contract calls with the seed's own NEAR key. Only calls
 * on Ink's list go through: the signer writes each call's arguments, gas and deposit
 * itself from the step, decodes its own bytes, reads the calls back from them alone,
 * and refuses unless they say exactly what the step says, to the same contract, from
 * this seed's own account.
 */
export function signNearCalls(seed: Uint8Array, step: PlanStep, live: { nonce: bigint; blockHash: Uint8Array }): SignedNearTransfer {
  const { signerId, publicKey, receiverId, calls } = callsOfStep(step)
  const ownKey = ownNearKey(seed, { signerId, publicKey })
  const bytes = encodeTransaction({ signerId, publicKey, nonce: live.nonce, receiverId, blockHash: live.blockHash, actions: actionsOfCalls(calls) })
  const read = decodeTransaction(bytes)
  const agrees =
    read.signerId === signerId &&
    read.receiverId === receiverId &&
    read.nonce === live.nonce &&
    same(read.publicKey, publicKey) &&
    same(read.blockHash, live.blockHash) &&
    sameCalls(callsOfTransaction(read), calls)
  if (!agrees) throw new NearDecodeError('the encoded transaction does not read back as the step')
  return signBytes(seed, ownKey, bytes)
}
