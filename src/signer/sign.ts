import { hexToBytes } from '@noble/hashes/utils.js'
import { NearDecodeError } from '../shared/near/transaction'
import type { PlanStep } from '../shared/plan'
import type { LiveInputs, SignedStep } from '../shared/vault'
import { signNearTransfer } from './near'

/** Thrown when the signer won't sign a step. It says why only to tests: the signer passes on no error text. */
export class SignRefusal extends Error {}

const NONCE = /^[1-9][0-9]{0,19}$/
const BLOCK_HASH = /^[0-9a-f]{64}$/
/** NEAR's nonce is a u64. */
const MAX_NONCE = 2n ** 64n - 1n

function liveOf({ nonce, blockHash }: LiveInputs): { nonce: bigint; blockHash: Uint8Array } {
  if (typeof nonce !== 'string' || !NONCE.test(nonce) || BigInt(nonce) > MAX_NONCE) throw new SignRefusal('the nonce is not a u64 above zero')
  if (typeof blockHash !== 'string' || !BLOCK_HASH.test(blockHash)) throw new SignRefusal('the block hash is not 32 bytes of hex')
  return { nonce: BigInt(nonce), blockHash: hexToBytes(blockHash) }
}

/**
 * Signs each step of an approved plan, in order, with the seed's own keys. Each
 * chain's signing half builds the transaction from the step and reads it back
 * before it signs; a step no signing half handles is refused, and so is the
 * whole plan with it. The seed is the caller's to wipe.
 */
export function signSteps(seed: Uint8Array, steps: readonly PlanStep[], live: readonly LiveInputs[]): SignedStep[] {
  if (steps.length === 0 || steps.length !== live.length) throw new SignRefusal('each step needs its live inputs')
  return steps.map((step, i) => {
    if (step.chain !== 'near' || step.action !== 'transfer') throw new SignRefusal('no signing half handles this step')
    try {
      return signNearTransfer(seed, step, liveOf(live[i] as LiveInputs))
    } catch (error) {
      if (error instanceof NearDecodeError) throw new SignRefusal(error.message)
      throw error
    }
  })
}
