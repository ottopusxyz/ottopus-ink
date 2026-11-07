import { secp256k1 } from '@noble/curves/secp256k1.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { keccak_256, sha3_256 } from '@noble/hashes/sha3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { base58, bech32, createBase58check } from '@scure/base'
import { HDKey } from '@scure/bip32'
import { ACCOUNT_CHAINS, ACCOUNT_PATHS, type Account, type AccountChain } from '../shared/accounts'
import { ed25519PublicKey } from './slip10'

const base58check = createBase58check(sha256)

/** The compressed secp256k1 public key at a BIP-32 path. Private bytes are wiped before it returns. */
function secp256k1PublicKey(seed: Uint8Array, path: string): Uint8Array {
  const root = HDKey.fromMasterSeed(seed)
  const node = root.derive(path)
  const key = node.publicKey
  node.wipePrivateData()
  root.wipePrivateData()
  if (!key) throw new Error('No public key')
  return key
}

/** The last 20 bytes of keccak-256 of the uncompressed key, as Ethereum and Tron both use. */
function keccakAddressBytes(compressed: Uint8Array): Uint8Array {
  const uncompressed = secp256k1.Point.fromBytes(compressed).toBytes(false)
  return keccak_256(uncompressed.subarray(1)).subarray(12)
}

/** EIP-55: hex with a checksum carried in the letters' case. */
function eip55(bytes: Uint8Array): string {
  const hex = bytesToHex(bytes)
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(hex)))
  return '0x' + [...hex].map((char, i) => (parseInt(hash.charAt(i), 16) >= 8 ? char.toUpperCase() : char)).join('')
}

const withByte = (prefix: number[], key: Uint8Array, suffix: number[] = []) => Uint8Array.from([...prefix, ...key, ...suffix])

/** Ed25519 keys are flagged 0 in both Sui and Aptos, before the key in Sui and after it in Aptos. */
const ADDRESS: Record<AccountChain, (seed: Uint8Array, path: string) => string> = {
  near: (seed, path) => bytesToHex(ed25519PublicKey(seed, path)),
  evm: (seed, path) => eip55(keccakAddressBytes(secp256k1PublicKey(seed, path))),
  solana: (seed, path) => base58.encode(ed25519PublicKey(seed, path)),
  bitcoin: (seed, path) => {
    const hash = ripemd160(sha256(secp256k1PublicKey(seed, path)))
    return bech32.encode('bc', [0, ...bech32.toWords(hash)])
  },
  tron: (seed, path) => base58check.encode(withByte([0x41], keccakAddressBytes(secp256k1PublicKey(seed, path)))),
  sui: (seed, path) => '0x' + bytesToHex(blake2b(withByte([0], ed25519PublicKey(seed, path)), { dkLen: 32 })),
  aptos: (seed, path) => '0x' + bytesToHex(sha3_256(withByte([], ed25519PublicKey(seed, path), [0]))),
}

/** The first account on every chain under a 64-byte BIP-39 seed. The seed is the caller's to wipe. */
export function deriveAccounts(seed: Uint8Array): Account[] {
  if (seed.length !== 64) throw new Error('A BIP-39 seed is 64 bytes')
  return ACCOUNT_CHAINS.map((chain) => {
    const path = ACCOUNT_PATHS[chain]
    return { chain, path, address: ADDRESS[chain](seed, path) }
  })
}
