import type { PlanStep } from '../plan'
import { isNearAccountId } from './account-id'
import { NearDecodeError, parseNearPublicKey, type NearAction, type NearTransaction } from './transaction'
import { formatNear } from './units'

/**
 * The NEAR contract calls Ink signs, and nothing else. A call can do anything its
 * contract allows, so Ink names each contract and method it will call, fixes the
 * deposit and gas for each, and writes every call's arguments itself from a few
 * checked values. A step holding anything else is refused, and so is its plan.
 *
 * Shared by main, which builds and shows the calls, and the signer, which builds
 * them again from the step and reads them back before it signs.
 */

/** NEAR's wrapped NEAR, the token 1Click and Intents take for NEAR. */
export const WRAP_NEAR = 'wrap.near'
/** The NEAR Intents contract, which holds each account's Intents balance. */
export const INTENTS_NEAR = 'intents.near'

/** One yoctoNEAR: what NEAR's token standards ask a transfer to attach, so only a full-access key can make one. */
export const ONE_YOCTO = 1n
/** What wrap.near asks to register an account: its storage_balance_bounds minimum, 0.00125 NEAR. */
export const WRAP_STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n
const TGAS = 10n ** 12n
/** NEAR's limit on the gas one transaction can attach. */
export const MAX_TRANSACTION_GAS = 300n * TGAS

/** A staking pool from NEAR's pool factories, such as `astro-stakers.poolv1.near`. */
const STAKING_POOL = /^[a-z0-9_-]{1,40}\.(poolv1|pool)\.near$/
/** An Intents token id: the standard, then the token. */
const INTENTS_TOKEN = /^nep(141|245):[A-Za-z0-9._:-]{1,200}$/
const WHOLE = /^[1-9][0-9]{0,38}$/
const U128_MAX = (1n << 128n) - 1n

/** Each call Ink makes, with the values its arguments are written from. Amounts are in the token's smallest unit. */
export type NearCall =
  /** Registers an account with wrap.near, so it can hold wNEAR. */
  | { method: 'storage_deposit'; accountId: string }
  /** Wraps NEAR into wNEAR. */
  | { method: 'near_deposit'; amount: bigint }
  /** Sends wNEAR. */
  | { method: 'ft_transfer'; receiverId: string; amount: bigint }
  /** Unwraps wNEAR back into NEAR. */
  | { method: 'near_withdraw'; amount: bigint }
  /** Moves a token inside the Intents balance to another Intents account. */
  | { method: 'mt_transfer'; receiverId: string; tokenId: string; amount: bigint }
  /** Takes a NEP-141 token out of the Intents balance to a NEAR account. */
  | { method: 'ft_withdraw'; token: string; receiverId: string; amount: bigint }
  /** Stakes NEAR with a pool. */
  | { method: 'deposit_and_stake'; amount: bigint }

export type NearCallMethod = NearCall['method']

interface CallRule {
  /** The contract it must call: one account, or a staking pool. */
  contract: typeof WRAP_NEAR | typeof INTENTS_NEAR | 'staking-pool'
  gas: bigint
  /** The deposit the call carries, fixed by its kind. */
  deposit: (call: NearCall) => bigint
  /** The arguments, in this order, as the contract reads them. */
  args: (call: NearCall) => Record<string, unknown>
  /** The step's fields for the call besides `method`, in order. */
  fields: readonly string[]
}

const amountOf = (call: NearCall): bigint => ('amount' in call ? call.amount : 0n)

/** Every call Ink may sign. Gas is generous for each method: what isn't used comes back. */
export const CALL_RULES: Record<NearCallMethod, CallRule> = {
  storage_deposit: {
    contract: WRAP_NEAR,
    gas: 10n * TGAS,
    deposit: () => WRAP_STORAGE_DEPOSIT,
    args: (call) => ({ account_id: (call as { accountId: string }).accountId, registration_only: true }),
    fields: ['accountId'],
  },
  near_deposit: { contract: WRAP_NEAR, gas: 10n * TGAS, deposit: amountOf, args: () => ({}), fields: ['amount'] },
  ft_transfer: {
    contract: WRAP_NEAR,
    gas: 30n * TGAS,
    deposit: () => ONE_YOCTO,
    args: (call) => ({ receiver_id: (call as { receiverId: string }).receiverId, amount: amountOf(call).toString() }),
    fields: ['receiverId', 'amount'],
  },
  near_withdraw: { contract: WRAP_NEAR, gas: 30n * TGAS, deposit: () => ONE_YOCTO, args: (call) => ({ amount: amountOf(call).toString() }), fields: ['amount'] },
  mt_transfer: {
    contract: INTENTS_NEAR,
    gas: 50n * TGAS,
    deposit: () => ONE_YOCTO,
    args: (call) => {
      const { receiverId, tokenId } = call as { receiverId: string; tokenId: string }
      return { receiver_id: receiverId, token_id: tokenId, amount: amountOf(call).toString() }
    },
    fields: ['receiverId', 'tokenId', 'amount'],
  },
  ft_withdraw: {
    contract: INTENTS_NEAR,
    gas: 100n * TGAS,
    deposit: () => ONE_YOCTO,
    args: (call) => {
      const { token, receiverId } = call as { token: string; receiverId: string }
      return { token, receiver_id: receiverId, amount: amountOf(call).toString() }
    },
    fields: ['token', 'receiverId', 'amount'],
  },
  deposit_and_stake: { contract: 'staking-pool', gas: 150n * TGAS, deposit: amountOf, args: () => ({}), fields: ['amount'] },
}

const isMethod = (name: unknown): name is NearCallMethod => typeof name === 'string' && Object.hasOwn(CALL_RULES, name)

/** Whether a contract may receive this method's call. */
function callsContract(method: NearCallMethod, receiverId: string): boolean {
  const { contract } = CALL_RULES[method]
  return contract === 'staking-pool' ? STAKING_POOL.test(receiverId) : contract === receiverId
}

function amountFrom(text: unknown): bigint {
  if (typeof text !== 'string' || !WHOLE.test(text) || BigInt(text) > U128_MAX) throw new NearDecodeError('an amount is not a whole number above zero')
  return BigInt(text)
}

function accountFrom(text: unknown, what: string): string {
  if (typeof text !== 'string' || !isNearAccountId(text)) throw new NearDecodeError(`the ${what} is not a NEAR account id`)
  return text
}

/** A call from its method and string values, checked. Throws `NearDecodeError` for anything off the list. */
function callFrom(method: unknown, values: Record<string, unknown>): NearCall {
  if (!isMethod(method)) throw new NearDecodeError('Ink does not sign that method')
  switch (method) {
    case 'storage_deposit':
      return { method, accountId: accountFrom(values.accountId, 'account') }
    case 'near_deposit':
    case 'near_withdraw':
    case 'deposit_and_stake':
      return { method, amount: amountFrom(values.amount) }
    case 'ft_transfer':
      return { method, receiverId: accountFrom(values.receiverId, 'receiver'), amount: amountFrom(values.amount) }
    case 'mt_transfer': {
      const tokenId = values.tokenId
      if (typeof tokenId !== 'string' || !INTENTS_TOKEN.test(tokenId)) throw new NearDecodeError('not an Intents token id')
      return { method, receiverId: accountFrom(values.receiverId, 'receiver'), tokenId, amount: amountFrom(values.amount) }
    }
    case 'ft_withdraw':
      return { method, token: accountFrom(values.token, 'token'), receiverId: accountFrom(values.receiverId, 'receiver'), amount: amountFrom(values.amount) }
  }
}

/** A call as the step stores it: its method, then its values as strings, in the rule's order. */
function callRecord(call: NearCall): Record<string, string> {
  const record: Record<string, string> = { method: call.method }
  for (const field of CALL_RULES[call.method].fields) {
    const value = (call as unknown as Record<string, unknown>)[field]
    record[field] = typeof value === 'bigint' ? value.toString() : String(value)
  }
  return record
}

/** Checks a list of calls to one contract, as one transaction holds them. Throws `NearDecodeError`. */
function checkCalls(receiverId: string, calls: readonly NearCall[]): void {
  if (calls.length === 0 || calls.length > 4) throw new NearDecodeError('a transaction holds one to four calls')
  for (const call of calls) if (!callsContract(call.method, receiverId)) throw new NearDecodeError(`${call.method} is not a call Ink makes to ${receiverId}`)
  const gas = calls.reduce((sum, call) => sum + CALL_RULES[call.method].gas, 0n)
  if (gas > MAX_TRANSACTION_GAS) throw new NearDecodeError('the calls need more gas than a transaction can attach')
}

/**
 * A plan step's fields for calls to one contract. Every value is a string so the plan
 * hash covers it exactly; `calls` is the calls as JSON, written one way only.
 */
export interface NearCallFields {
  signerId: string
  publicKey: string
  receiverId: string
  calls: string
}

const STEP_FIELDS = ['calls', 'publicKey', 'receiverId', 'signerId']

export function nearCallStep({ signerId, publicKey, receiverId, calls }: { signerId: string; publicKey: string; receiverId: string; calls: readonly NearCall[] }): PlanStep {
  checkCalls(receiverId, calls)
  return { chain: 'near', action: 'call', fields: { signerId, publicKey, receiverId, calls: JSON.stringify(calls.map(callRecord)) } }
}

/** The calls a plan step holds, checked against the list. Throws `NearDecodeError` for any other step. */
export function callsOfStep(step: PlanStep): { signerId: string; publicKey: Uint8Array; receiverId: string; calls: NearCall[] } {
  if (step.chain !== 'near' || step.action !== 'call') throw new NearDecodeError('not a NEAR call step')
  if (Object.keys(step.fields).sort().join() !== STEP_FIELDS.join()) throw new NearDecodeError('a NEAR call step has exactly its four fields')
  const { signerId, publicKey, receiverId, calls: text } = step.fields as unknown as NearCallFields
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new NearDecodeError('the calls are not JSON')
  }
  if (!Array.isArray(parsed)) throw new NearDecodeError('the calls are not a list')
  const calls = parsed.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new NearDecodeError('a call is not an object')
    const { method, ...values } = entry as Record<string, unknown>
    const call = callFrom(method, values)
    if (Object.keys(values).sort().join() !== [...CALL_RULES[call.method].fields].sort().join()) throw new NearDecodeError('a call has fields its method does not take')
    return call
  })
  checkCalls(accountFrom(receiverId, 'receiver'), calls)
  // One way to write each step, so no two that read the same can hash differently.
  if (JSON.stringify(calls.map(callRecord)) !== text) throw new NearDecodeError('the calls are not written as Ink writes them')
  return { signerId: accountFrom(signerId, 'signer'), publicKey: parseNearPublicKey(publicKey), receiverId, calls }
}

/** The actions for each call: the method, Ink's own arguments, and the rule's gas and deposit. */
export function actionsOfCalls(calls: readonly NearCall[]): NearAction[] {
  const encoder = new TextEncoder()
  return calls.map((call) => {
    const rule = CALL_RULES[call.method]
    return { kind: 'FunctionCall', methodName: call.method, args: encoder.encode(JSON.stringify(rule.args(call))), gas: rule.gas, deposit: rule.deposit(call) }
  })
}

/**
 * The calls a transaction makes, read from its actions alone: each must be on the list,
 * to its contract, with the rule's gas and deposit and arguments exactly as Ink writes
 * them. The signer reads its own bytes back with this before it signs.
 */
export function callsOfTransaction(transaction: NearTransaction): NearCall[] {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const calls = transaction.actions.map((action) => {
    if (action.kind !== 'FunctionCall') throw new NearDecodeError('not a call')
    if (!isMethod(action.methodName)) throw new NearDecodeError('Ink does not sign that method')
    let args: unknown
    try {
      args = JSON.parse(decoder.decode(action.args))
    } catch {
      throw new NearDecodeError('the arguments are not JSON')
    }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new NearDecodeError('the arguments are not an object')
    const named = args as Record<string, unknown>
    const values: Record<string, unknown> = {
      accountId: named.account_id,
      receiverId: named.receiver_id,
      tokenId: named.token_id,
      token: named.token,
      amount: action.methodName === 'near_deposit' || action.methodName === 'deposit_and_stake' ? action.deposit.toString() : named.amount,
    }
    const call = callFrom(action.methodName, values)
    const rule = CALL_RULES[call.method]
    const expected = new TextEncoder().encode(JSON.stringify(rule.args(call)))
    if (expected.length !== action.args.length || expected.some((byte, i) => byte !== action.args[i])) throw new NearDecodeError('the arguments are not as Ink writes them')
    if (action.gas !== rule.gas || action.deposit !== rule.deposit(call)) throw new NearDecodeError('the gas or deposit is not the call’s own')
    return call
  })
  checkCalls(transaction.receiverId, calls)
  return calls
}

/** Whether two lists of calls say exactly the same thing. */
export function sameCalls(a: readonly NearCall[], b: readonly NearCall[]): boolean {
  return a.length === b.length && a.every((call, i) => JSON.stringify(callRecord(call)) === JSON.stringify(callRecord(b[i] as NearCall)))
}

/**
 * What a call does, in plain words for the review window. Amounts in a token's smallest
 * unit are named as such: the call itself doesn't say how many decimals the token has.
 */
export function describeCall(call: NearCall, receiverId: string): string {
  switch (call.method) {
    case 'storage_deposit':
      return `Register ${call.accountId} with wNEAR, paying ${formatNear(WRAP_STORAGE_DEPOSIT)} NEAR for its storage`
    case 'near_deposit':
      return `Wrap ${formatNear(call.amount)} NEAR into wNEAR`
    case 'ft_transfer':
      return `Send ${formatNear(call.amount)} wNEAR to ${call.receiverId}`
    case 'near_withdraw':
      return `Unwrap ${formatNear(call.amount)} wNEAR back into NEAR`
    case 'mt_transfer':
      return `Move ${call.amount} (in its smallest unit) of ${call.tokenId} from your NEAR Intents balance to ${call.receiverId}`
    case 'ft_withdraw':
      return `Withdraw ${call.amount} (in its smallest unit) of ${call.token} from your NEAR Intents balance to ${call.receiverId}`
    case 'deposit_and_stake':
      return `Stake ${formatNear(call.amount)} NEAR with ${receiverId}`
  }
}

/** The most a step's calls attach in NEAR deposits, yoctoNEAR: what leaves the account besides fees. */
export function callsDeposit(calls: readonly NearCall[]): bigint {
  return calls.reduce((sum, call) => sum + CALL_RULES[call.method].deposit(call), 0n)
}

/** The gas a step's calls attach, which the fee ceiling is worked out from. */
export function callsGas(calls: readonly NearCall[]): bigint {
  return calls.reduce((sum, call) => sum + CALL_RULES[call.method].gas, 0n)
}
