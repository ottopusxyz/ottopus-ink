import type { Account } from '../../shared/accounts'
import type { PlanRecipient } from '../../shared/plan'

/** What can sit around an address in a sentence but never inside one. */
const SEPARATORS = /[\s,;:()[\]{}<>"'`]+/

/** End-of-sentence marks. No address on any of Ink's chains ends with one. */
const TRAILING = /[.!?]+$/

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

/**
 * Whether two addresses are the same. EVM addresses are hex, so case only ever
 * carries a checksum and is ignored. Every other chain's address is compared
 * exactly: Solana's and Tron's are case-sensitive, and NEAR's are lower case.
 */
function sameAddress(a: string, b: string): boolean {
  return EVM_ADDRESS.test(a) && EVM_ADDRESS.test(b) ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Whether the person typed this address, whole, in one of their own messages. */
function typedBy(address: string, messages: readonly string[]): boolean {
  return messages.some((message) => message.split(SEPARATORS).some((word) => sameAddress(word.replace(TRAILING, ''), address)))
}

/**
 * Who a plan may pay. Only one of the person's own addresses, or one they typed
 * themselves in the chat: never one the agent came up with, which is how a
 * prompt injection would try to send funds elsewhere. Returns null when the
 * address is neither. `typed` must be the person's own messages, as main
 * captured them from the page, never anything the agent wrote.
 */
export function allowedRecipient(address: string, own: readonly Account[], typed: readonly string[]): PlanRecipient | null {
  if (!address) return null
  if (own.some((account) => sameAddress(account.address, address))) return { address, why: 'own' }
  if (typedBy(address, typed)) return { address, why: 'typed' }
  return null
}
