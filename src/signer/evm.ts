import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { HDKey } from '@scure/bip32'
import { ACCOUNT_PATHS } from '../shared/accounts'
import { decodeEvmSigned, EvmDecodeError, evmSigned, evmSigningHash, evmTransferOfStep, readsAs, type EvmLive } from '../shared/evm/transaction'
import type { PlanStep } from '../shared/plan'

/** The address of an uncompressed secp256k1 key, lower case: the last 20 bytes of keccak-256 of the key. */
const addressOf = (publicKey: Uint8Array) => `0x${bytesToHex(keccak_256(secp256k1.Point.fromBytes(publicKey).toBytes(false).subarray(1)).subarray(12))}`

/**
 * Signs an EVM transfer step with the wallet's own EVM key: builds the EIP-1559
 * transaction from the step and the live inputs, reads its own bytes back and checks they
 * make exactly that transfer, and only then signs. The step must spend from this seed's
 * address. The seed is the caller's to wipe; the key is wiped here.
 */
export function signEvmTransfer(seed: Uint8Array, step: PlanStep, live: EvmLive): { signed: Uint8Array; transactionId: string } {
  const transfer = evmTransferOfStep(step)
  const root = HDKey.fromMasterSeed(seed)
  const node = root.derive(ACCOUNT_PATHS.evm)
  try {
    const key = node.privateKey
    const publicKey = node.publicKey
    if (!key || !publicKey) throw new EvmDecodeError('no EVM key')
    if (addressOf(publicKey) !== transfer.from.toLowerCase()) throw new EvmDecodeError('the step spends from an address this seed does not hold')
    const hash = evmSigningHash(transfer, live)
    const signature = secp256k1.Signature.fromBytes(secp256k1.sign(hash, key, { prehash: false, lowS: true, format: 'recovered' }), 'recovered')
    if (signature.recovery === undefined) throw new EvmDecodeError('no recovery bit')
    const { signed, hash: transactionId } = evmSigned(transfer, live, { recovery: signature.recovery, r: signature.r, s: signature.s })
    // Read back what was built: it must make exactly this transfer, and its signature must be this key's.
    const read = decodeEvmSigned(signed)
    if (!readsAs(read, transfer, live)) throw new EvmDecodeError('the signed transaction does not read back as the step')
    const recovered = new secp256k1.Signature(read.r, read.s, read.recovery).recoverPublicKey(hash).toBytes(true)
    if (bytesToHex(recovered) !== bytesToHex(publicKey)) throw new EvmDecodeError('the signature is not this key’s')
    return { signed, transactionId }
  } finally {
    node.wipePrivateData()
    root.wipePrivateData()
  }
}
