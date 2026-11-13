import { sha256 } from '@noble/hashes/sha2.js'
import { base58 } from '@scure/base'
import type { PlanStep } from '../plan'
import { isNearAccountId } from './account-id'

/**
 * NEAR transactions, written and read byte for byte in Borsh, the encoding NEAR
 * signs. Only what Ink sends is supported: a version 0 transaction from an
 * ed25519 key, holding one Transfer, or up to four FunctionCalls to one
 * contract. Anything else fails to decode, so the signer can refuse whatever it
 * couldn't read itself.
 *
 * Shared by main, which shows the decoded transfer, and the signer, which
 * decodes again before it signs.
 */

export class NearDecodeError extends Error {
  override name = 'NearDecodeError'
}

/** One transfer, with every field NEAR signs. */
export interface NearTransfer {
  signerId: string
  /** The signer's ed25519 public key, 32 bytes. */
  publicKey: Uint8Array
  nonce: bigint
  receiverId: string
  /** A recent block's hash, 32 bytes. The transaction is only valid for about a day after it. */
  blockHash: Uint8Array
  /** yoctoNEAR. */
  deposit: bigint
}

/** One action in a transaction: a plain transfer, or a call to the receiver's contract. */
export type NearAction =
  | { kind: 'Transfer'; deposit: bigint }
  | {
      kind: 'FunctionCall'
      methodName: string
      /** The call's arguments, as the contract reads them: JSON for every call Ink makes. */
      args: Uint8Array
      /** Gas attached for the call. What isn't used comes back. */
      gas: bigint
      /** yoctoNEAR attached to the call. */
      deposit: bigint
    }

/** Every field NEAR signs, for a transaction of one or more actions to one receiver. */
export interface NearTransaction {
  signerId: string
  publicKey: Uint8Array
  nonce: bigint
  receiverId: string
  blockHash: Uint8Array
  actions: NearAction[]
}

const KEY_ED25519 = 0
/** The FunctionCall and Transfer variants of nearcore's Action enum. */
const ACTION_FUNCTION_CALL = 2
const ACTION_TRANSFER = 3
/** More than any transaction Ink builds needs. */
export const MAX_ACTIONS = 4
/** Longer than any call's arguments Ink writes. */
export const MAX_ARGS_BYTES = 2048
/** A contract method's name, as Rust and nearcore allow it. */
const METHOD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const U64_MAX = (1n << 64n) - 1n
const U128_MAX = (1n << 128n) - 1n

function writer() {
  const bytes: number[] = []
  const little = (value: bigint, size: number) => {
    for (let i = 0; i < size; i++) bytes.push(Number((value >> BigInt(8 * i)) & 0xffn))
  }
  return {
    u8: (value: number) => bytes.push(value),
    u32: (value: number) => little(BigInt(value), 4),
    u64: (value: bigint) => little(value, 8),
    u128: (value: bigint) => little(value, 16),
    fixed: (value: Uint8Array) => bytes.push(...value),
    bytes(value: Uint8Array) {
      little(BigInt(value.length), 4)
      bytes.push(...value)
    },
    string(value: string) {
      const utf8 = new TextEncoder().encode(value)
      little(BigInt(utf8.length), 4)
      bytes.push(...utf8)
    },
    done: () => Uint8Array.from(bytes),
  }
}

function reader(bytes: Uint8Array) {
  let at = 0
  const take = (size: number): Uint8Array => {
    if (at + size > bytes.length) throw new NearDecodeError('the transaction ends early')
    const part = bytes.subarray(at, at + size)
    at += size
    return part
  }
  const little = (size: number): bigint => take(size).reduceRight((value, byte) => (value << 8n) | BigInt(byte), 0n)
  return {
    u8: () => take(1)[0]!,
    u32: () => Number(little(4)),
    u64: () => little(8),
    u128: () => little(16),
    fixed: (size: number) => Uint8Array.from(take(size)),
    bytes(max: number, what: string) {
      const length = Number(little(4))
      if (length > max) throw new NearDecodeError(`the ${what} is too long`)
      return Uint8Array.from(take(length))
    },
    accountId(what: string) {
      const length = Number(little(4))
      if (length > 64) throw new NearDecodeError(`the ${what} is too long to be an account id`)
      let id: string
      try {
        // ignoreBOM keeps a leading byte order mark in the string, so the account id check refuses it.
        id = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(take(length))
      } catch (error) {
        if (error instanceof NearDecodeError) throw error
        throw new NearDecodeError(`the ${what} is not UTF-8`)
      }
      if (!isNearAccountId(id)) throw new NearDecodeError(`the ${what} is not a NEAR account id`)
      return id
    },
    end() {
      if (at !== bytes.length) throw new NearDecodeError('the transaction has bytes after its end')
    },
  }
}

function checkTransfer({ signerId, publicKey, nonce, receiverId, blockHash, deposit }: NearTransfer): void {
  if (!isNearAccountId(signerId) || !isNearAccountId(receiverId)) throw new NearDecodeError('not a NEAR account id')
  if (publicKey.length !== 32 || blockHash.length !== 32) throw new NearDecodeError('a key or block hash is not 32 bytes')
  if (nonce < 0n || nonce > U64_MAX || deposit < 0n || deposit > U128_MAX) throw new NearDecodeError('a number is out of range')
}

/** The bytes NEAR signs for one transfer. */
export function encodeTransfer(transfer: NearTransfer): Uint8Array {
  checkTransfer(transfer)
  const out = writer()
  out.string(transfer.signerId)
  out.u8(KEY_ED25519)
  out.fixed(transfer.publicKey)
  out.u64(transfer.nonce)
  out.string(transfer.receiverId)
  out.fixed(transfer.blockHash)
  out.u32(1)
  out.u8(ACTION_TRANSFER)
  out.u128(transfer.deposit)
  return out.done()
}

/** Reads a transaction back, refusing anything but one ed25519 Transfer with nothing after it. */
export function decodeTransfer(bytes: Uint8Array): NearTransfer {
  const read = reader(bytes)
  const signerId = read.accountId('signer')
  if (read.u8() !== KEY_ED25519) throw new NearDecodeError('only ed25519 keys are supported')
  const publicKey = read.fixed(32)
  const nonce = read.u64()
  const receiverId = read.accountId('receiver')
  const blockHash = read.fixed(32)
  if (read.u32() !== 1) throw new NearDecodeError('a transaction must hold exactly one action')
  if (read.u8() !== ACTION_TRANSFER) throw new NearDecodeError('only a Transfer can be read')
  const deposit = read.u128()
  read.end()
  return { signerId, publicKey, nonce, receiverId, blockHash, deposit }
}

function checkTransaction(transaction: NearTransaction): void {
  const { actions } = transaction
  checkTransfer({ ...transaction, deposit: 0n })
  if (actions.length === 0 || actions.length > MAX_ACTIONS) throw new NearDecodeError(`a transaction holds one to ${MAX_ACTIONS} actions`)
  const calls = actions.filter((action) => action.kind === 'FunctionCall')
  // A transfer goes alone; calls go together, all to the receiver's contract.
  if (calls.length !== actions.length && actions.length !== 1) throw new NearDecodeError('a transfer goes in a transaction of its own')
  for (const action of actions) {
    if (action.deposit < 0n || action.deposit > U128_MAX) throw new NearDecodeError('a deposit is out of range')
    if (action.kind === 'FunctionCall') {
      if (!METHOD_NAME.test(action.methodName)) throw new NearDecodeError('not a method name')
      if (action.args.length > MAX_ARGS_BYTES) throw new NearDecodeError('the arguments are too long')
      if (action.gas <= 0n || action.gas > U64_MAX) throw new NearDecodeError('the gas is out of range')
    }
  }
}

/** The bytes NEAR signs for a transaction of one transfer, or of calls to one contract. */
export function encodeTransaction(transaction: NearTransaction): Uint8Array {
  checkTransaction(transaction)
  const out = writer()
  out.string(transaction.signerId)
  out.u8(KEY_ED25519)
  out.fixed(transaction.publicKey)
  out.u64(transaction.nonce)
  out.string(transaction.receiverId)
  out.fixed(transaction.blockHash)
  out.u32(transaction.actions.length)
  for (const action of transaction.actions) {
    if (action.kind === 'Transfer') {
      out.u8(ACTION_TRANSFER)
      out.u128(action.deposit)
    } else {
      out.u8(ACTION_FUNCTION_CALL)
      out.string(action.methodName)
      out.bytes(action.args)
      out.u64(action.gas)
      out.u128(action.deposit)
    }
  }
  return out.done()
}

/** Reads a transaction back, refusing any action but a Transfer or a FunctionCall, and anything after its end. */
export function decodeTransaction(bytes: Uint8Array): NearTransaction {
  const read = reader(bytes)
  const signerId = read.accountId('signer')
  if (read.u8() !== KEY_ED25519) throw new NearDecodeError('only ed25519 keys are supported')
  const publicKey = read.fixed(32)
  const nonce = read.u64()
  const receiverId = read.accountId('receiver')
  const blockHash = read.fixed(32)
  const count = read.u32()
  if (count === 0 || count > MAX_ACTIONS) throw new NearDecodeError(`a transaction holds one to ${MAX_ACTIONS} actions`)
  const actions: NearAction[] = []
  for (let i = 0; i < count; i++) {
    const kind = read.u8()
    if (kind === ACTION_TRANSFER) {
      actions.push({ kind: 'Transfer', deposit: read.u128() })
    } else if (kind === ACTION_FUNCTION_CALL) {
      const name = read.bytes(64, 'method name')
      let methodName: string
      try {
        methodName = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(name)
      } catch {
        throw new NearDecodeError('the method name is not UTF-8')
      }
      const args = read.bytes(MAX_ARGS_BYTES, 'arguments')
      actions.push({ kind: 'FunctionCall', methodName, args, gas: read.u64(), deposit: read.u128() })
    } else {
      throw new NearDecodeError('only Transfer and FunctionCall actions can be read')
    }
  }
  read.end()
  const transaction = { signerId, publicKey, nonce, receiverId, blockHash, actions }
  checkTransaction(transaction)
  return transaction
}

/** What gets signed: the SHA-256 of the transaction's bytes. It is also the transaction's id. */
export const transactionHash = (bytes: Uint8Array): Uint8Array => sha256(bytes)

/** The id NEAR shows for a transaction, in base58. */
export const transactionId = (bytes: Uint8Array): string => base58.encode(transactionHash(bytes))

/** A transaction and its ed25519 signature, as `send_tx` takes them. */
export function encodeSignedTransaction(transaction: Uint8Array, signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) throw new NearDecodeError('an ed25519 signature is 64 bytes')
  const out = new Uint8Array(transaction.length + 1 + 64)
  out.set(transaction)
  out[transaction.length] = KEY_ED25519
  out.set(signature, transaction.length + 1)
  return out
}

/** A public key as NEAR writes it: `ed25519:` and base58. */
export const nearPublicKey = (key: Uint8Array): string => `ed25519:${base58.encode(key)}`

export function parseNearPublicKey(text: string): Uint8Array {
  const match = /^ed25519:([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(text)
  const key = match ? base58.decode(match[1]!) : null
  if (!key || key.length !== 32) throw new NearDecodeError('not an ed25519 public key')
  return key
}

/**
 * A plan step's fields for a NEAR transfer. Every value is a string, so the
 * plan hash covers them exactly. The nonce and block hash are left out: they go
 * stale, so they're filled in when the step is signed.
 */
export interface NearTransferFields {
  signerId: string
  publicKey: string
  receiverId: string
  /** yoctoNEAR, as a decimal string. */
  deposit: string
}

const FIELD_NAMES = ['deposit', 'publicKey', 'receiverId', 'signerId']

export function nearTransferStep(fields: NearTransferFields): PlanStep {
  return { chain: 'near', action: 'transfer', fields: { ...fields } }
}

/** The transfer a plan step describes, once the live nonce and block hash are known. Throws on any other step. */
export function transferOfStep(step: PlanStep, live: { nonce: bigint; blockHash: Uint8Array }): NearTransfer {
  if (step.chain !== 'near' || step.action !== 'transfer') throw new NearDecodeError('not a NEAR transfer step')
  const names = Object.keys(step.fields).sort()
  if (names.join() !== FIELD_NAMES.join()) throw new NearDecodeError('a NEAR transfer step has exactly its four fields')
  const { signerId, publicKey, receiverId, deposit } = step.fields as unknown as NearTransferFields
  if (!/^(0|[1-9][0-9]*)$/.test(deposit)) throw new NearDecodeError('the deposit is not a whole number of yoctoNEAR')
  const transfer = { signerId, publicKey: parseNearPublicKey(publicKey), nonce: live.nonce, receiverId, blockHash: live.blockHash, deposit: BigInt(deposit) }
  checkTransfer(transfer)
  return transfer
}
