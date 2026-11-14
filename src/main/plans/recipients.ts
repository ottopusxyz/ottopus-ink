import { ACCOUNT_CHAINS, type Account, type AccountChain } from '../../shared/accounts'
import { evmChainOf } from '../../shared/evm/chains'
import type { PlanRecipient, Sent } from '../../shared/plan'

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

/** Whether this address appears, whole, in a text. */
function appearsIn(address: string, text: string): boolean {
  return text.split(SEPARATORS).some((word) => sameAddress(word.replace(TRAILING, ''), address))
}


/**
 * Which of the person's accounts lives on a chain, by the chain's name. Null for
 * a missing or unknown chain: then no address counts as the person's own, since
 * owning an address on one chain says nothing about the same string on another
 * (a Sui and an Aptos address look alike).
 */
function accountChainOf(chain: string | null): AccountChain | null {
  if (!chain) return null
  const name = chain.toLowerCase()
  // Every EVM chain Ink sends on shares the wallet's single EVM address.
  if (name === 'evm' || evmChainOf(name)) return 'evm'
  return (ACCOUNT_CHAINS as readonly string[]).includes(name) && name !== 'evm' ? (name as AccountChain) : null
}

/**
 * Who a plan may pay on `chain`, the chain the funds land on. Only the person's
 * own address on that chain, one they typed in the chat, or one in a file they
 * attached: never one the agent came up with, which is how a prompt injection
 * would try to send funds elsewhere. Returns null when the address is none of
 * those. `sent` must be what was sent from Ink's chat box and the files picked
 * in its file dialog, as main captured them, never anything the agent wrote.
 * Typed beats attached, which the review window marks for a closer look.
 */
export function allowedRecipient(address: string, chain: string | null, own: readonly Account[], sent: readonly Sent[]): PlanRecipient | null {
  if (!address) return null
  const on = accountChainOf(chain)
  if (on && own.some((account) => account.chain === on && sameAddress(account.address, address))) return { address, why: 'own' }
  if (sent.some((each) => typeof each === 'string' && appearsIn(address, each))) return { address, why: 'typed' }
  const file = sent.find((each): each is Exclude<Sent, string> => typeof each !== 'string' && appearsIn(address, each.text))
  if (file) return { address, why: 'attached', file: file.file }
  return null
}
