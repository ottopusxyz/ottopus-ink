import { ed25519 } from '@noble/curves/ed25519.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha512 } from '@noble/hashes/sha2.js'

const HARDENED = 0x80000000
const CURVE_KEY = new TextEncoder().encode('ed25519 seed')

/** Parses a path where every level is hardened, as SLIP-10 requires for ed25519. */
function parsePath(path: string): number[] {
  const [root, ...levels] = path.split('/')
  if (root !== 'm') throw new Error('A path starts with m')
  return levels.map((level) => {
    const match = /^(\d+)'$/.exec(level)
    const index = match ? Number(match[1]) : NaN
    if (!Number.isSafeInteger(index) || index >= HARDENED) throw new Error('ed25519 paths are hardened at every level')
    return index + HARDENED
  })
}

/**
 * SLIP-10 for ed25519: the key under a BIP-39 seed that NEAR, Solana, Sui and
 * Aptos wallets use. Returns the public key only, and wipes every private byte
 * on the way.
 */
export function ed25519PublicKey(seed: Uint8Array, path: string): Uint8Array {
  const indexes = parsePath(path)
  let node = hmac(sha512, CURVE_KEY, seed)
  for (const index of indexes) {
    const data = new Uint8Array(37)
    data.set(node.subarray(0, 32), 1)
    new DataView(data.buffer).setUint32(33, index)
    const child = hmac(sha512, node.subarray(32), data)
    data.fill(0)
    node.fill(0)
    node = child
  }
  const secret = node.subarray(0, 32)
  try {
    return ed25519.getPublicKey(secret)
  } finally {
    node.fill(0)
  }
}
