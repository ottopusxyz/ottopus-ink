import { hexToBytes } from '@noble/hashes/utils.js'
import { NearDecodeError } from '../shared/near/transaction'
import type { PlanStep } from '../shared/plan'
import type { LiveInputs, SignedStep } from '../shared/vault'
import { EvmDecodeError, type EvmLive } from '../shared/evm/transaction'
import { signEvmTransfer } from './evm'
import { signSolanaTransfer } from './solana'
import { SolanaDecodeError, type SolanaLive } from '../shared/solana/transaction'
import { isSolanaAddress } from '../shared/addresses'
import { signNearCalls, signNearTransfer } from './near'

/** Thrown when the signer won't sign a step. It says why only to tests: the signer passes on no error text. */
export class SignRefusal extends Error {}

const NONCE = /^[1-9][0-9]{0,19}$/
const BLOCK_HASH = /^[0-9a-f]{64}$/
/** NEAR's nonce is a u64. */
const MAX_NONCE = 2n ** 64n - 1n

function liveOf(live: LiveInputs): { nonce: bigint; blockHash: Uint8Array } {
  const nonce = 'nonce' in live ? live.nonce : undefined
  const blockHash = 'blockHash' in live ? live.blockHash : undefined
  if (typeof nonce !== 'string' || !NONCE.test(nonce) || BigInt(nonce) > MAX_NONCE) throw new SignRefusal('the nonce is not a u64 above zero')
  if (typeof blockHash !== 'string' || !BLOCK_HASH.test(blockHash)) throw new SignRefusal('the block hash is not 32 bytes of hex')
  return { nonce: BigInt(nonce), blockHash: hexToBytes(blockHash) }
}

/** An EVM account's nonce starts at zero. */
const EVM_NONCE = /^(0|[1-9][0-9]{0,19})$/
/** Wei per unit of gas, under 2^128. */
const WEI = /^(0|[1-9][0-9]{0,38})$/

function evmLiveOf(live: LiveInputs): EvmLive {
  const nonce = 'nonce' in live ? live.nonce : undefined
  const cap = 'maxFeePerGas' in live ? live.maxFeePerGas : undefined
  const tip = 'maxPriorityFeePerGas' in live ? live.maxPriorityFeePerGas : undefined
  if (typeof nonce !== 'string' || !EVM_NONCE.test(nonce) || BigInt(nonce) > MAX_NONCE) throw new SignRefusal('the nonce is not a u64')
  if (typeof cap !== 'string' || !WEI.test(cap) || typeof tip !== 'string' || !WEI.test(tip)) throw new SignRefusal('the fee caps are not whole numbers of wei')
  return { nonce: BigInt(nonce), maxFeePerGas: BigInt(cap), maxPriorityFeePerGas: BigInt(tip) }
}

function solanaLiveOf(live: LiveInputs): SolanaLive {
  const recentBlockhash = 'recentBlockhash' in live ? live.recentBlockhash : undefined
  // A blockhash is 32 bytes in base58, as an address is.
  if (typeof recentBlockhash !== 'string' || !isSolanaAddress(recentBlockhash)) throw new SignRefusal('the blockhash is not 32 bytes of base58')
  return { recentBlockhash }
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
    try {
      if (step.chain === 'evm' && step.action === 'transfer') return signEvmTransfer(seed, step, evmLiveOf(live[i] as LiveInputs))
      if (step.chain === 'solana' && step.action === 'transfer') return signSolanaTransfer(seed, step, solanaLiveOf(live[i] as LiveInputs))
      if (step.chain !== 'near' || (step.action !== 'transfer' && step.action !== 'call')) throw new SignRefusal('no signing half handles this step')
      const inputs = liveOf(live[i] as LiveInputs)
      return step.action === 'call' ? signNearCalls(seed, step, inputs) : signNearTransfer(seed, step, inputs)
    } catch (error) {
      if (error instanceof NearDecodeError || error instanceof EvmDecodeError || error instanceof SolanaDecodeError) throw new SignRefusal(error.message)
      throw error
    }
  })
}
