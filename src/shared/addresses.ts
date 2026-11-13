import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { base58 } from '@scure/base'
import type { AccountChain } from './accounts'
import { isNearAccountId } from './near/account-id'

/**
 * Whether a string is an address on a chain, so a payout to a typed address can't go to
 * something that only looks like one. A transfer to a mistyped address can't be undone.
 * Only the chains Ink checks so far: EVM, Solana and NEAR. Every other chain is refused.
 */
export function isAddressOn(chain: AccountChain, address: string): boolean {
  switch (chain) {
    case 'evm':
      return isEvmAddress(address)
    case 'solana':
      return isSolanaAddress(address)
    case 'near':
      return isNearAccountId(address)
    default:
      return false
  }
}

/**
 * `0x` and 40 hex digits. All one case carries no checksum and is taken as it is; mixed
 * case is EIP-55's checksum, and must be right, since a wrong one means a typo.
 */
export function isEvmAddress(address: string): boolean {
  const match = /^0x([0-9a-fA-F]{40})$/.exec(address)
  if (!match) return false
  const hex = match[1] as string
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(hex.toLowerCase())))
  return [...hex].every((char, i) => (/[0-9]/.test(char) ? true : (parseInt(hash[i] as string, 16) >= 8) === (char === char.toUpperCase())))
}

/** A Solana address: an ed25519 public key, 32 bytes in base58. */
export function isSolanaAddress(address: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false
  try {
    return base58.decode(address).length === 32
  } catch {
    return false
  }
}
