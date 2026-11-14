import { ed25519 } from '@noble/curves/ed25519.js'
import { base58 } from '@scure/base'
import { ACCOUNT_PATHS } from '../shared/accounts'
import type { PlanStep } from '../shared/plan'
import { decodeSolanaSigned, readsAs, SolanaDecodeError, solanaMessage, solanaSigned, solanaTransferOfStep, type SolanaLive } from '../shared/solana/transaction'
import { ed25519PublicKey, ed25519Sign } from './slip10'

/**
 * Signs a Solana transfer step with the wallet's own Solana key: builds the message from
 * the step and the recent blockhash, signs it, reads the signed transaction back and checks
 * it makes exactly that transfer and that the signature is this key's. The step must spend
 * from this seed's address. The seed is the caller's to wipe.
 */
export function signSolanaTransfer(seed: Uint8Array, step: PlanStep, live: SolanaLive): { signed: Uint8Array; transactionId: string } {
  const transfer = solanaTransferOfStep(step)
  const ownKey = ed25519PublicKey(seed, ACCOUNT_PATHS.solana)
  if (base58.encode(ownKey) !== transfer.from) throw new SolanaDecodeError('the step spends from an address this seed does not hold')
  const message = solanaMessage(transfer, live)
  const { publicKey, signature } = ed25519Sign(seed, ACCOUNT_PATHS.solana, message)
  const { signed, transactionId } = solanaSigned(message, signature)
  // Read back what was built: it must make exactly this transfer, and its signature must be this key's.
  const read = decodeSolanaSigned(signed)
  if (!readsAs(read, transfer, live)) throw new SolanaDecodeError('the signed transaction does not read back as the step')
  if (!ed25519.verify(read.signature, read.message, publicKey)) throw new SolanaDecodeError('the signature is not this key’s')
  return { signed, transactionId }
}
