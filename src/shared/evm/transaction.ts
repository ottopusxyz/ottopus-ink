import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { isEvmAddress } from '../addresses'
import type { PlanStep } from '../plan'
import { evmChainById } from './chains'
import { bigintBytes, bytesBigint, rlpDecode, rlpEncode, type Rlp } from './rlp'

/**
 * A send on an EVM chain from the wallet's own address: the chain's coin, or an ERC-20
 * token by its contract. Shared by main, which builds and shows it, and the signer, which
 * builds the transaction again from the step and reads it back before it signs.
 */

/** Thrown for a step or transaction Ink won't take as one of its own EVM transfers. */
export class EvmDecodeError extends Error {}

export interface EvmTransfer {
  chainId: number
  /** The wallet's own address, which signs. */
  from: string
  /** Who gets the coin or token. */
  to: string
  /** `native` for the chain's coin, else the token's contract. */
  token: 'native' | string
  /** In the coin's or token's smallest unit. */
  amount: bigint
  /** The most gas the transaction may use: worked out when the plan is made, and part of what's approved. */
  gas: bigint
  /** How the coin or token reads, for review: main reads both from the chain itself. The signer doesn't use them. */
  symbol: string
  decimals: number
}

/** What the chain says just before signing: the address's next nonce, and the fee caps per unit of gas. */
export interface EvmLive {
  nonce: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}

const WHOLE = /^(0|[1-9][0-9]{0,77})$/
const U256 = 2n ** 256n
/** A plain coin transfer's gas; a token transfer needs more, and a contract here no more than this. */
export const MIN_GAS = 21_000n
export const MAX_GAS = 3_000_000n
/** ERC-20's `transfer(address,uint256)`. */
const TRANSFER = 'a9059cbb'
const STEP_FIELDS = ['amount', 'chainId', 'decimals', 'from', 'gas', 'symbol', 'to', 'token']
/** A token's symbol as review shows it: one short word. */
const SYMBOL = /^[A-Za-z0-9.$+-]{1,16}$/

const lower = (address: string) => address.toLowerCase()

/** The step for a transfer. Every value a string, so the plan hash covers it exactly. */
export function evmTransferStep(transfer: EvmTransfer): PlanStep {
  checkTransfer(transfer)
  return {
    chain: 'evm',
    action: 'transfer',
    fields: {
      chainId: String(transfer.chainId),
      from: transfer.from,
      to: transfer.to,
      token: transfer.token === 'native' ? 'native' : lower(transfer.token),
      amount: transfer.amount.toString(),
      gas: transfer.gas.toString(),
      symbol: transfer.symbol,
      decimals: String(transfer.decimals),
    },
  }
}

function checkTransfer({ chainId, from, to, token, amount, gas, symbol, decimals }: EvmTransfer): void {
  if (!SYMBOL.test(symbol) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new EvmDecodeError('the symbol or decimals are off')
  if (!evmChainById(chainId)) throw new EvmDecodeError('not a chain Ink sends on')
  if (!isEvmAddress(from) || !isEvmAddress(to)) throw new EvmDecodeError('an address is not an EVM address')
  if (token !== 'native' && !/^0x[0-9a-f]{40}$/.test(token)) throw new EvmDecodeError('the token is not a contract address')
  if (token !== 'native' && lower(token) === lower(to)) throw new EvmDecodeError('a token sent to its own contract is lost')
  if (amount <= 0n || amount >= U256) throw new EvmDecodeError('the amount is not a whole number above zero')
  if (gas < MIN_GAS || gas > MAX_GAS) throw new EvmDecodeError('the gas is outside what a transfer needs')
}

/** The transfer a plan step holds, checked. Throws `EvmDecodeError` for any other step. */
export function evmTransferOfStep(step: PlanStep): EvmTransfer {
  if (step.chain !== 'evm' || step.action !== 'transfer') throw new EvmDecodeError('not an EVM transfer step')
  if (Object.keys(step.fields).sort().join() !== STEP_FIELDS.join()) throw new EvmDecodeError('an EVM transfer step has exactly its eight fields')
  const { chainId, from, to, token, amount, gas, symbol, decimals } = step.fields as Record<string, string>
  if (![chainId, amount, gas, decimals].every((number) => WHOLE.test(number ?? ''))) throw new EvmDecodeError('a number is not written as a whole number')
  const transfer: EvmTransfer = {
    chainId: Number(chainId),
    from: from as string,
    to: to as string,
    token: token as string,
    amount: BigInt(amount as string),
    gas: BigInt(gas as string),
    symbol: symbol as string,
    decimals: Number(decimals),
  }
  checkTransfer(transfer)
  // One way to write each step, so no two that read the same can hash differently.
  const again = evmTransferStep(transfer)
  if (STEP_FIELDS.some((field) => again.fields[field] !== step.fields[field])) throw new EvmDecodeError('the step is not written as Ink writes it')
  return transfer
}

const pad32 = (bytes: Uint8Array) => {
  const out = new Uint8Array(32)
  out.set(bytes, 32 - bytes.length)
  return out
}

/** The call a token transfer makes: `transfer(to, amount)`. */
function transferData(to: string, amount: bigint): Uint8Array {
  return Uint8Array.from([...hexToBytes(TRANSFER), ...pad32(hexToBytes(lower(to).slice(2))), ...pad32(bigintBytes(amount))])
}

/** The fields of an EIP-1559 transaction, in its order, before any signature. */
function payload(transfer: EvmTransfer, live: EvmLive): Rlp[] {
  const native = transfer.token === 'native'
  return [
    bigintBytes(BigInt(transfer.chainId)),
    bigintBytes(live.nonce),
    bigintBytes(live.maxPriorityFeePerGas),
    bigintBytes(live.maxFeePerGas),
    bigintBytes(transfer.gas),
    hexToBytes(lower(native ? transfer.to : transfer.token).slice(2)),
    bigintBytes(native ? transfer.amount : 0n),
    native ? new Uint8Array(0) : transferData(transfer.to, transfer.amount),
    [],
  ]
}

const typed = (body: Uint8Array) => Uint8Array.from([0x02, ...body])

/** What the signature covers: keccak-256 of the typed, unsigned transaction. */
export function evmSigningHash(transfer: EvmTransfer, live: EvmLive): Uint8Array {
  checkLive(live)
  return keccak_256(typed(rlpEncode(payload(transfer, live))))
}

function checkLive({ nonce, maxFeePerGas, maxPriorityFeePerGas }: EvmLive): void {
  if (nonce < 0n || nonce >= 2n ** 64n) throw new EvmDecodeError('the nonce is not a u64')
  if (maxFeePerGas <= 0n || maxPriorityFeePerGas < 0n || maxPriorityFeePerGas > maxFeePerGas || maxFeePerGas >= 2n ** 128n) throw new EvmDecodeError('the fee caps are not ones a chain takes')
}

/** The signed transaction's bytes and its hash, the id explorers show. */
export function evmSigned(transfer: EvmTransfer, live: EvmLive, signature: { recovery: number; r: bigint; s: bigint }): { signed: Uint8Array; hash: string } {
  const signed = typed(rlpEncode([...payload(transfer, live), bigintBytes(BigInt(signature.recovery)), bigintBytes(signature.r), bigintBytes(signature.s)]))
  return { signed, hash: `0x${bytesToHex(keccak_256(signed))}` }
}

/** A signed EIP-1559 transaction read back: what it pays, how, and its signature. */
export interface EvmReadBack {
  chainId: number
  nonce: bigint
  maxPriorityFeePerGas: bigint
  maxFeePerGas: bigint
  gas: bigint
  /** The address it calls or pays, lower case. */
  callee: string
  value: bigint
  data: Uint8Array
  recovery: number
  r: bigint
  s: bigint
}

/** Reads a signed EIP-1559 transaction strictly. Throws `EvmDecodeError`. */
export function decodeEvmSigned(bytes: Uint8Array): EvmReadBack {
  if (bytes[0] !== 0x02) throw new EvmDecodeError('not an EIP-1559 transaction')
  let fields: Rlp
  try {
    fields = rlpDecode(bytes.subarray(1))
  } catch (error) {
    throw new EvmDecodeError(error instanceof Error ? error.message : 'not RLP')
  }
  if (!Array.isArray(fields) || fields.length !== 12) throw new EvmDecodeError('not twelve fields')
  const [chainId, nonce, tip, cap, gas, callee, value, data, access, recovery, r, s] = fields
  if (!(callee instanceof Uint8Array) || callee.length !== 20 || !(data instanceof Uint8Array)) throw new EvmDecodeError('the callee or data is not bytes')
  if (!Array.isArray(access) || access.length > 0) throw new EvmDecodeError('Ink sends no access list')
  try {
    const read = (value: Rlp | undefined) => bytesBigint(value as Rlp)
    const parity = read(recovery)
    if (parity > 1n) throw new EvmDecodeError('the signature’s parity is not 0 or 1')
    return { chainId: Number(read(chainId)), nonce: read(nonce), maxPriorityFeePerGas: read(tip), maxFeePerGas: read(cap), gas: read(gas), callee: `0x${bytesToHex(callee)}`, value: read(value), data, recovery: Number(parity), r: read(r), s: read(s) }
  } catch (error) {
    if (error instanceof EvmDecodeError) throw error
    throw new EvmDecodeError(error instanceof Error ? error.message : 'a field is off')
  }
}

/**
 * Whether a signed transaction makes exactly this transfer with these live inputs: the
 * chain, nonce, fee caps and gas, and the coin to the recipient, or the token's own
 * `transfer` to the recipient with no coin attached.
 */
export function readsAs(read: EvmReadBack, transfer: EvmTransfer, live: EvmLive): boolean {
  const same = read.chainId === transfer.chainId && read.nonce === live.nonce && read.maxFeePerGas === live.maxFeePerGas && read.maxPriorityFeePerGas === live.maxPriorityFeePerGas && read.gas === transfer.gas
  if (!same) return false
  if (transfer.token === 'native') return read.callee === lower(transfer.to) && read.value === transfer.amount && read.data.length === 0
  return read.callee === lower(transfer.token) && read.value === 0n && bytesToHex(read.data) === bytesToHex(transferData(transfer.to, transfer.amount))
}

