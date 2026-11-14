import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base58 } from '@scure/base'
import { isSolanaAddress } from '../addresses'
import type { PlanStep } from '../plan'

/**
 * A send on Solana from the wallet's own address: SOL, or an SPL token by its mint. Shared
 * by main, which builds and shows it, and the signer, which builds the transaction again
 * from the step and reads it back before it signs.
 *
 * A token goes from the sender's associated token account to the recipient's, which the
 * transaction creates first if it isn't there yet (and leaves alone if it is), paid by the
 * sender. Only the original SPL Token program's tokens, which USDC and USDT on Solana are.
 */

/** Thrown for a step or transaction Ink won't take as one of its own Solana transfers. */
export class SolanaDecodeError extends Error {}

export interface SolanaTransfer {
  /** The wallet's own address, which signs and pays the fees. */
  from: string
  /** Who gets the SOL or token: a wallet address, never a token account. */
  to: string
  /** `native` for SOL, else the token's mint. */
  token: 'native' | string
  /** In lamports, or the token's smallest unit. */
  amount: bigint
  /** How the coin or token reads, for review: main reads the decimals from the mint. The signer checks them on chain through `TransferChecked`. */
  symbol: string
  decimals: number
}

/** What the chain says just before signing: a recent blockhash, which a transaction must name to land. */
export interface SolanaLive {
  recentBlockhash: string
}

export const SYSTEM_PROGRAM = '11111111111111111111111111111111'
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111'

/** Lamports per signature, Solana's base fee. */
export const SIGNATURE_FEE = 5_000n
/** A priority fee, so the transaction lands when the chain is busy: micro-lamports per compute unit. */
export const COMPUTE_UNIT_PRICE = 100_000n
/** The compute each kind of transfer may use: SOL's is tiny; a token's may create the recipient's token account. */
export const COMPUTE_UNITS = { native: 10_000, token: 80_000 } as const
/** What a token account must hold to stay open, paid once if the recipient doesn't have one yet: 165 bytes, rent-exempt. */
export const TOKEN_ACCOUNT_RENT = 2_039_280n
/** What a plain account must hold to exist at all: zero bytes, rent-exempt. */
export const ACCOUNT_RENT = 890_880n

const U64 = 2n ** 64n
const WHOLE = /^(0|[1-9][0-9]{0,77})$/
const STEP_FIELDS = ['amount', 'decimals', 'from', 'symbol', 'to', 'token']
/** A token's symbol as review shows it: one short word. */
const SYMBOL = /^[A-Za-z0-9.$+-]{1,16}$/

/** The step for a transfer. Every value a string, so the plan hash covers it exactly. */
export function solanaTransferStep(transfer: SolanaTransfer): PlanStep {
  checkTransfer(transfer)
  return {
    chain: 'solana',
    action: 'transfer',
    fields: {
      from: transfer.from,
      to: transfer.to,
      token: transfer.token,
      amount: transfer.amount.toString(),
      symbol: transfer.symbol,
      decimals: String(transfer.decimals),
    },
  }
}

function checkTransfer({ from, to, token, amount, symbol, decimals }: SolanaTransfer): void {
  if (!SYMBOL.test(symbol) || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new SolanaDecodeError('the symbol or decimals are off')
  if (!isSolanaAddress(from) || !isSolanaAddress(to)) throw new SolanaDecodeError('an address is not a Solana address')
  if (from === to) throw new SolanaDecodeError('a transfer to itself')
  if (token !== 'native' && !isSolanaAddress(token)) throw new SolanaDecodeError('the token is not a mint address')
  if (token === 'native' && decimals !== 9) throw new SolanaDecodeError('SOL has nine decimals')
  if ([SYSTEM_PROGRAM, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM].includes(to) || to === token) throw new SolanaDecodeError('a transfer to a program or a mint is lost')
  if (amount <= 0n || amount >= U64) throw new SolanaDecodeError('the amount is not a whole number above zero')
}

/** The transfer a plan step holds, checked. Throws `SolanaDecodeError` for any other step. */
export function solanaTransferOfStep(step: PlanStep): SolanaTransfer {
  if (step.chain !== 'solana' || step.action !== 'transfer') throw new SolanaDecodeError('not a Solana transfer step')
  if (Object.keys(step.fields).sort().join() !== STEP_FIELDS.join()) throw new SolanaDecodeError('a Solana transfer step has exactly its six fields')
  const { from, to, token, amount, symbol, decimals } = step.fields as Record<string, string>
  if (!WHOLE.test(amount ?? '') || !/^[0-9]{1,2}$/.test(decimals ?? '')) throw new SolanaDecodeError('a number is not written as a whole number')
  const transfer: SolanaTransfer = { from: from as string, to: to as string, token: token as string, amount: BigInt(amount as string), symbol: symbol as string, decimals: Number(decimals) }
  checkTransfer(transfer)
  // One way to write each step, so no two that read the same can hash differently.
  const again = solanaTransferStep(transfer)
  if (STEP_FIELDS.some((field) => again.fields[field] !== step.fields[field])) throw new SolanaDecodeError('the step is not written as Ink writes it')
  return transfer
}

/** The most the transaction's fees take, in lamports: the signature, the priority fee, and the recipient's token account if it must be made. */
export function solanaFee(transfer: SolanaTransfer, createsTokenAccount: boolean): bigint {
  const units = BigInt(transfer.token === 'native' ? COMPUTE_UNITS.native : COMPUTE_UNITS.token)
  const priority = (units * COMPUTE_UNIT_PRICE + 999_999n) / 1_000_000n
  return SIGNATURE_FEE + priority + (transfer.token !== 'native' && createsTokenAccount ? TOKEN_ACCOUNT_RENT : 0n)
}

const key = (address: string): Uint8Array => {
  const bytes = base58.decode(address)
  if (bytes.length !== 32) throw new SolanaDecodeError('not a 32-byte key')
  return bytes
}
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i])

/** Whether 32 bytes are a point on ed25519, as Solana decides it: a program address must not be. */
function onCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromBytes(bytes, true)
    return true
  } catch {
    return false
  }
}

/** A program address, as Solana finds one: the first bump, from 255 down, whose hash is off the curve. */
export function findProgramAddress(seeds: readonly Uint8Array[], program: string): string {
  const marker = new TextEncoder().encode('ProgramDerivedAddress')
  for (let bump = 255; bump >= 0; bump--) {
    const hash = sha256(Uint8Array.from([...seeds.flatMap((seed) => [...seed]), bump, ...key(program), ...marker]))
    if (!onCurve(hash)) return base58.encode(hash)
  }
  throw new SolanaDecodeError('no program address')
}

/** A wallet's associated token account for a mint, under the original token program. */
export const associatedTokenAccount = (owner: string, mint: string): string => findProgramAddress([key(owner), key(TOKEN_PROGRAM), key(mint)], ASSOCIATED_TOKEN_PROGRAM)

function compactU16(value: number): number[] {
  const out: number[] = []
  let rest = value
  for (;;) {
    const low = rest & 0x7f
    rest >>= 7
    if (rest === 0) {
      out.push(low)
      return out
    }
    out.push(low | 0x80)
  }
}

const le = (value: bigint, bytes: number): number[] => Array.from({ length: bytes }, (_, i) => Number((value >> BigInt(8 * i)) & 0xffn))
const readLe = (bytes: Uint8Array): bigint => bytes.reduceRight((sum, byte) => (sum << 8n) | BigInt(byte), 0n)

interface Instruction {
  program: string
  accounts: string[]
  data: number[]
}

/** The accounts a transfer's message lists, in Solana's order: the signer, the other writable ones, then the read-only ones. */
function layout(transfer: SolanaTransfer): { keys: string[]; readonlyUnsigned: number; instructions: Instruction[] } {
  const units = transfer.token === 'native' ? COMPUTE_UNITS.native : COMPUTE_UNITS.token
  const budget: Instruction[] = [
    { program: COMPUTE_BUDGET_PROGRAM, accounts: [], data: [2, ...le(BigInt(units), 4)] },
    { program: COMPUTE_BUDGET_PROGRAM, accounts: [], data: [3, ...le(COMPUTE_UNIT_PRICE, 8)] },
  ]
  if (transfer.token === 'native') {
    return {
      keys: [transfer.from, transfer.to, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM],
      readonlyUnsigned: 2,
      instructions: [...budget, { program: SYSTEM_PROGRAM, accounts: [transfer.from, transfer.to], data: [2, 0, 0, 0, ...le(transfer.amount, 8)] }],
    }
  }
  const source = associatedTokenAccount(transfer.from, transfer.token)
  const destination = associatedTokenAccount(transfer.to, transfer.token)
  return {
    keys: [transfer.from, source, destination, transfer.to, transfer.token, SYSTEM_PROGRAM, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, COMPUTE_BUDGET_PROGRAM],
    readonlyUnsigned: 6,
    instructions: [
      ...budget,
      // CreateIdempotent: makes the recipient's token account, paid by the sender, or does nothing if it's there.
      { program: ASSOCIATED_TOKEN_PROGRAM, accounts: [transfer.from, destination, transfer.to, transfer.token, SYSTEM_PROGRAM, TOKEN_PROGRAM], data: [1] },
      // TransferChecked: the chain refuses it unless the mint's decimals are these.
      { program: TOKEN_PROGRAM, accounts: [source, transfer.token, destination, transfer.from], data: [12, ...le(transfer.amount, 8), transfer.decimals] },
    ],
  }
}

/** The message the signature covers: a legacy Solana message. */
export function solanaMessage(transfer: SolanaTransfer, live: SolanaLive): Uint8Array {
  checkTransfer(transfer)
  const blockhash = key(live.recentBlockhash)
  const { keys, readonlyUnsigned, instructions } = layout(transfer)
  const index = (address: string) => keys.indexOf(address)
  return Uint8Array.from([
    1,
    0,
    readonlyUnsigned,
    ...compactU16(keys.length),
    ...keys.flatMap((address) => [...key(address)]),
    ...blockhash,
    ...compactU16(instructions.length),
    ...instructions.flatMap((instruction) => [index(instruction.program), ...compactU16(instruction.accounts.length), ...instruction.accounts.map(index), ...compactU16(instruction.data.length), ...instruction.data]),
  ])
}

/** The signed transaction's bytes and its id, the signature in base58, which explorers show. */
export function solanaSigned(message: Uint8Array, signature: Uint8Array): { signed: Uint8Array; transactionId: string } {
  if (signature.length !== 64) throw new SolanaDecodeError('a signature is 64 bytes')
  return { signed: Uint8Array.from([1, ...signature, ...message]), transactionId: base58.encode(signature) }
}

/** A signed Solana transaction read back: its one signature, and its message as the chain reads it. */
export interface SolanaReadBack {
  signature: Uint8Array
  message: Uint8Array
  header: [number, number, number]
  keys: string[]
  recentBlockhash: string
  instructions: Instruction[]
}

/** Reads a signed legacy transaction with one signature strictly. Throws `SolanaDecodeError`. */
export function decodeSolanaSigned(bytes: Uint8Array): SolanaReadBack {
  let at = 0
  const take = (count: number): Uint8Array => {
    if (at + count > bytes.length) throw new SolanaDecodeError('the transaction ends early')
    const out = bytes.subarray(at, at + count)
    at += count
    return out
  }
  const length = (): number => {
    let value = 0
    for (let shift = 0; shift < 21; shift += 7) {
      const byte = take(1)[0] as number
      value |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return value
    }
    throw new SolanaDecodeError('a length is too long')
  }
  if (length() !== 1) throw new SolanaDecodeError('Ink signs with one key')
  const signature = Uint8Array.from(take(64))
  const start = at
  const first = take(1)[0] as number
  if (first & 0x80) throw new SolanaDecodeError('Ink sends legacy messages only')
  const header: [number, number, number] = [first, take(1)[0] as number, take(1)[0] as number]
  const keys = Array.from({ length: length() }, () => base58.encode(take(32)))
  const recentBlockhash = base58.encode(take(32))
  const instructions = Array.from({ length: length() }, () => {
    const programIndex = take(1)[0] as number
    const accounts = Array.from(take(length())).map((i) => keys[i])
    const data = Array.from(take(length()))
    const program = keys[programIndex]
    if (!program || accounts.some((account) => account === undefined)) throw new SolanaDecodeError('an index is outside the accounts')
    return { program, accounts: accounts as string[], data }
  })
  if (at !== bytes.length) throw new SolanaDecodeError('bytes after the message')
  return { signature, message: Uint8Array.from(bytes.subarray(start)), header, keys, recentBlockhash, instructions }
}

/**
 * Whether a signed transaction makes exactly this transfer with this blockhash, read from
 * its own bytes: one signer, the sender, paying; the compute budget Ink sets; and then
 * either SOL from the sender to the recipient, or the recipient's token account made if
 * missing and the token moved from the sender's token account to it, with the mint's decimals.
 */
export function readsAs(read: SolanaReadBack, transfer: SolanaTransfer, live: SolanaLive): boolean {
  const [signers, readonlySigned, readonlyUnsigned] = read.header
  if (signers !== 1 || readonlySigned !== 0 || read.keys[0] !== transfer.from || read.recentBlockhash !== live.recentBlockhash) return false
  if (new Set(read.keys).size !== read.keys.length) return false
  const writable = (address: string) => {
    const i = read.keys.indexOf(address)
    return i >= 0 && i < read.keys.length - readonlyUnsigned
  }
  const same = (instruction: Instruction | undefined, program: string, accounts: string[], data: number[]) =>
    instruction !== undefined && instruction.program === program && instruction.accounts.join() === accounts.join() && sameBytes(Uint8Array.from(instruction.data), Uint8Array.from(data))
  const units = transfer.token === 'native' ? COMPUTE_UNITS.native : COMPUTE_UNITS.token
  const [limit, price, ...rest] = read.instructions
  if (!same(limit, COMPUTE_BUDGET_PROGRAM, [], [2, ...le(BigInt(units), 4)]) || !same(price, COMPUTE_BUDGET_PROGRAM, [], [3, ...le(COMPUTE_UNIT_PRICE, 8)])) return false
  if (transfer.token === 'native') {
    const [send, ...more] = rest
    if (more.length > 0 || !same(send, SYSTEM_PROGRAM, [transfer.from, transfer.to], [2, 0, 0, 0, ...le(transfer.amount, 8)])) return false
    return writable(transfer.from) && writable(transfer.to) && !writable(SYSTEM_PROGRAM) && !writable(COMPUTE_BUDGET_PROGRAM)
  }
  const [create, move, ...more] = rest
  const source = associatedTokenAccount(transfer.from, transfer.token)
  const destination = associatedTokenAccount(transfer.to, transfer.token)
  if (more.length > 0) return false
  if (!same(create, ASSOCIATED_TOKEN_PROGRAM, [transfer.from, destination, transfer.to, transfer.token, SYSTEM_PROGRAM, TOKEN_PROGRAM], [1])) return false
  if (!same(move, TOKEN_PROGRAM, [source, transfer.token, destination, transfer.from], [12, ...le(transfer.amount, 8), transfer.decimals])) return false
  // Only what must change is writable: the payer and the two token accounts.
  const shouldWrite = new Set([transfer.from, source, destination])
  return read.keys.every((address) => writable(address) === shouldWrite.has(address))
}

/** The amount a token account holds, from its data: 165 bytes, the amount at 64. Null for anything else. */
export function tokenAccountAmount(data: Uint8Array): bigint | null {
  return data.length === 165 ? readLe(data.subarray(64, 72)) : null
}

/** A mint's decimals, from its data: 82 bytes, the decimals at 44, initialized at 45. Null for anything else. */
export function mintDecimals(data: Uint8Array): number | null {
  return data.length === 82 && data[45] === 1 ? (data[44] as number) : null
}
