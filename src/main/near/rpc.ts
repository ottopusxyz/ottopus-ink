import { base58, base64 } from '@scure/base'
import { decodeTransfer, transactionId as idOf } from '../../shared/near/transaction'

/** Free mainnet RPCs, tried in order. FastNEAR first; NEAR's own as the fallback. */
export const NEAR_RPC_URLS = ['https://rpc.mainnet.fastnear.com', 'https://rpc.mainnet.near.org'] as const

/**
 * - `unavailable`: no RPC answered, or none answered sensibly. Worth trying again later.
 * - `unknown-account`: NEAR says the account doesn't exist. For an implicit account that only means nothing was sent to it yet.
 * - `rejected`: NEAR answered with an error, such as an invalid transaction.
 */
export type NearRpcFailure = 'unavailable' | 'unknown-account' | 'rejected'

export class NearRpcError extends Error {
  override name = 'NearRpcError'
  constructor(
    readonly reason: NearRpcFailure,
    message: string,
  ) {
    super(message)
  }
}

export interface NearAccountView {
  /** Liquid balance, yoctoNEAR. */
  amount: bigint
  /** Staked as a validator, yoctoNEAR. Pool stakes are not here: they belong to the pool's account. */
  locked: bigint
  storageUsage: bigint
}

export interface NearAccessKeyView {
  nonce: bigint
  /** The block the answer came from: recent enough to build a transaction on. */
  blockHash: Uint8Array
  blockHeight: bigint
}

/** Gas one fee costs: sent when the sender pays, executed when the receiver runs it. Sender and receiver differ for a send. */
export interface NearFeeGas {
  send: bigint
  exec: bigint
}

/** What a transfer's fees are made of, from the protocol config the RPC runs. */
export interface NearProtocolFees {
  /** yoctoNEAR per gas the gas for receipts is bought at, at least (NEP-642). */
  minGasPurchasePrice: bigint
  /** Creating the receipt that carries the actions. */
  receipt: NearFeeGas
  transfer: NearFeeGas
  /** What a transfer to an implicit account adds: creating the account, then (for a NEAR implicit one) its full access key. */
  createAccount: NearFeeGas
  addFullAccessKey: NearFeeGas
}

/** How a sent transaction ended, as far as NEAR's final outcome says. */
export interface NearTxOutcome {
  transactionId: string
  /** True only when the transaction and every receipt it made succeeded. */
  ok: boolean
  /** NEAR's own reason when it failed, as text. */
  failure: string | null
}

type Fetch = typeof globalThis.fetch

export interface NearRpcOptions {
  urls?: readonly string[]
  fetch?: Fetch
  timeoutMs?: number
  /** Sending waits for the transaction to be final, which takes a few blocks. */
  sendTimeoutMs?: number
}

const WHOLE = /^(0|[1-9][0-9]*)$/
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function whole(value: unknown, what: string): bigint {
  if (typeof value === 'string' && WHOLE.test(value)) return BigInt(value)
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  throw new NearRpcError('unavailable', `the RPC sent a ${what} that isn't a whole number`)
}

function hash32(value: unknown, what: string): Uint8Array {
  let bytes: Uint8Array | null
  try {
    bytes = typeof value === 'string' ? base58.decode(value) : null
  } catch {
    bytes = null
  }
  if (!bytes || bytes.length !== 32) throw new NearRpcError('unavailable', `the RPC sent a ${what} that isn't a 32-byte hash`)
  return bytes
}

function feeGas(value: unknown, what: string): NearFeeGas {
  if (!isRecord(value)) throw new NearRpcError('unavailable', `the RPC sent no ${what} fee`)
  return { send: whole(value.send_not_sir, `${what} fee`), exec: whole(value.execution, `${what} fee`) }
}

/** The name of NEAR's error, wherever in the reply it sits. */
function errorName(error: Record<string, unknown>): string {
  const cause = isRecord(error.cause) ? error.cause : null
  return String(cause?.name ?? error.name ?? 'error')
}

const STATUS_KINDS = ['SuccessValue', 'SuccessReceiptId', 'Failure'] as const

/** The outcome's status once it has run, or null while it hasn't (`Unknown`) or isn't the shape NEAR sends. */
function finishedStatus(outcome: unknown): Record<string, unknown> | null {
  const status = isRecord(outcome) && isRecord(outcome.outcome) ? outcome.outcome.status : null
  return isRecord(status) && STATUS_KINDS.some((kind) => kind in status) ? status : null
}

/** The first failure in the transaction or any receipt it made, as text, or null when none failed. */
function failureOf(result: Record<string, unknown>, receipts: unknown[]): string | null {
  const status = result.status
  if (isRecord(status) && 'Failure' in status) return JSON.stringify(status.Failure)
  for (const receipt of receipts) {
    const inner = finishedStatus(receipt)
    if (inner && 'Failure' in inner) return JSON.stringify(inner.Failure)
  }
  return null
}

/** Which transaction an outcome must be about. */
interface Expected {
  transactionId: string
  senderId: string
}

/**
 * Reads a final outcome, refusing one about another transaction, or one that
 * isn't complete: no transaction outcome, no receipt, or a receipt that hasn't run.
 */
function outcomeOf(result: unknown, expected: Expected): NearTxOutcome {
  const status = isRecord(result) ? result.status : null
  if (!isRecord(result) || !isRecord(result.transaction) || !isRecord(status) || !STATUS_KINDS.some((kind) => kind in status)) {
    throw new NearRpcError('unavailable', 'the RPC sent no transaction outcome')
  }
  const { transaction } = result
  const about = isRecord(result.transaction_outcome) ? result.transaction_outcome.id : null
  if (transaction.hash !== expected.transactionId || about !== expected.transactionId || transaction.signer_id !== expected.senderId) {
    throw new NearRpcError('unavailable', 'the RPC sent the outcome of another transaction')
  }
  const receipts = Array.isArray(result.receipts_outcome) ? result.receipts_outcome : []
  if (!finishedStatus(result.transaction_outcome) || receipts.length === 0 || !receipts.every((receipt) => finishedStatus(receipt))) {
    throw new NearRpcError('unavailable', 'the RPC sent an outcome that is not complete')
  }
  const failure = failureOf(result, receipts)
  return { transactionId: expected.transactionId, ok: failure === null && 'SuccessValue' in status, failure }
}

export function createNearRpc({ urls = NEAR_RPC_URLS, fetch = globalThis.fetch, timeoutMs = 8_000, sendTimeoutMs = 60_000 }: NearRpcOptions = {}) {
  let nextId = 0

  /**
   * One JSON-RPC call, trying each RPC until one answers. A transport failure
   * moves on to the next; an answer from NEAR, error or not, is final.
   *
   * Sending is different once an RPC has failed to answer: it may have taken
   * the transaction anyway, so a later RPC's error (an invalid nonce, say,
   * because the first one's went through) proves nothing. `sends` makes such an
   * error `unavailable`, not `rejected`.
   */
  async function call(method: string, params: unknown, timeout = timeoutMs, { sends = false } = {}): Promise<unknown> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: `ink-${++nextId}`, method, params })
    for (const [index, url] of urls.entries()) {
      // Reaching a later RPC means every earlier one went unanswered.
      const unanswered = index > 0
      let reply: unknown
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(timeout) })
        if (!response.ok && response.status >= 500) continue
        reply = await response.json()
      } catch {
        continue
      }
      if (!isRecord(reply)) continue
      if (isRecord(reply.error)) {
        const name = errorName(reply.error)
        if (sends && unanswered) throw new NearRpcError('unavailable', `NEAR answered ${name}, but an earlier RPC may have taken the transaction`)
        if (name === 'UNKNOWN_ACCOUNT' || name === 'UNKNOWN_ACCESS_KEY') throw new NearRpcError('unknown-account', `NEAR answered ${name}`)
        // Overloaded or behind: another RPC may do better.
        if (name === 'TIMEOUT_ERROR' || name === 'INTERNAL_ERROR' || name === 'UNKNOWN_BLOCK' || name === 'NO_SYNCED_BLOCKS') continue
        throw new NearRpcError('rejected', `NEAR answered ${name}`)
      }
      if ('result' in reply) return reply.result
    }
    throw new NearRpcError('unavailable', 'no NEAR RPC answered')
  }

  return {
    /** The account's balance, or null when NEAR has no such account yet. */
    async viewAccount(accountId: string): Promise<NearAccountView | null> {
      let result: unknown
      try {
        result = await call('query', { request_type: 'view_account', finality: 'final', account_id: accountId })
      } catch (error) {
        if (error instanceof NearRpcError && error.reason === 'unknown-account') return null
        throw error
      }
      if (!isRecord(result)) throw new NearRpcError('unavailable', 'the RPC sent no account')
      return { amount: whole(result.amount, 'balance'), locked: whole(result.locked, 'stake'), storageUsage: whole(result.storage_usage, 'storage use') }
    },

    /** The access key's nonce and a recent block, or null when the account or key doesn't exist. */
    async viewAccessKey(accountId: string, publicKey: string): Promise<NearAccessKeyView | null> {
      let result: unknown
      try {
        result = await call('query', { request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey })
      } catch (error) {
        if (error instanceof NearRpcError && error.reason === 'unknown-account') return null
        throw error
      }
      if (!isRecord(result)) throw new NearRpcError('unavailable', 'the RPC sent no access key')
      // RPCs still say a key is missing the old way: a result holding an error string.
      if (typeof result.error === 'string') {
        if (/does not exist/.test(result.error)) return null
        throw new NearRpcError('rejected', 'NEAR could not read the access key')
      }
      return { nonce: whole(result.nonce, 'nonce'), blockHash: hash32(result.block_hash, 'block hash'), blockHeight: whole(result.block_height, 'block height') }
    },

    /** Which NEAR network the RPC is on, as it says: `mainnet` for the real one. */
    async chainId(): Promise<string> {
      const result = await call('status', [])
      if (!isRecord(result) || typeof result.chain_id !== 'string') throw new NearRpcError('unavailable', 'the RPC sent no chain id')
      return result.chain_id
    },

    /** yoctoNEAR per unit of gas in the latest block. */
    async gasPrice(): Promise<bigint> {
      const result = await call('gas_price', [null])
      if (!isRecord(result)) throw new NearRpcError('unavailable', 'the RPC sent no gas price')
      return whole(result.gas_price, 'gas price')
    },

    /** The fees a transfer pays, from the protocol config of the latest final block. */
    async protocolFees(): Promise<NearProtocolFees> {
      const result = await call('EXPERIMENTAL_protocol_config', { finality: 'final' })
      const runtime = isRecord(result) && isRecord(result.runtime_config) ? result.runtime_config : null
      const costs = runtime && isRecord(runtime.transaction_costs) ? runtime.transaction_costs : null
      const actions = costs && isRecord(costs.action_creation_config) ? costs.action_creation_config : null
      const addKey = actions && isRecord(actions.add_key_cost) ? actions.add_key_cost : null
      if (!runtime || !costs || !actions || !addKey) throw new NearRpcError('unavailable', 'the RPC sent no protocol config')
      return {
        minGasPurchasePrice: whole(runtime.min_gas_purchase_price, 'minimum gas purchase price'),
        receipt: feeGas(costs.action_receipt_creation_config, 'receipt'),
        transfer: feeGas(actions.transfer_cost, 'transfer'),
        createAccount: feeGas(actions.create_account_cost, 'create account'),
        addFullAccessKey: feeGas(addKey.full_access_cost, 'add key'),
      }
    },

    /** A contract's view method, with its JSON result parsed. */
    async callView(contractId: string, method: string, args: unknown): Promise<unknown> {
      const argsBase64 = base64.encode(new TextEncoder().encode(JSON.stringify(args)))
      const result = await call('query', { request_type: 'call_function', finality: 'final', account_id: contractId, method_name: method, args_base64: argsBase64 })
      if (isRecord(result) && typeof result.error === 'string') throw new NearRpcError('rejected', 'NEAR could not run the view method')
      if (!isRecord(result) || !Array.isArray(result.result) || !result.result.every((byte) => Number.isInteger(byte) && byte >= 0 && byte < 256)) {
        throw new NearRpcError('unavailable', 'the RPC sent no view result')
      }
      try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(result.result as number[])))
      } catch {
        throw new NearRpcError('unavailable', 'the view result is not JSON')
      }
    },

    /**
     * Sends a signed transfer and waits until it's final. Sending the same
     * bytes twice is safe: NEAR runs a nonce once, so a retry on another RPC
     * can't spend twice. The outcome must be about this transaction, whose id
     * and signer are read from the bytes themselves.
     */
    async sendTransaction(signed: Uint8Array): Promise<NearTxOutcome> {
      const unsigned = signed.subarray(0, signed.length - 65)
      const expected = { transactionId: idOf(unsigned), senderId: decodeTransfer(unsigned).signerId }
      return outcomeOf(await call('send_tx', { signed_tx_base64: base64.encode(signed), wait_until: 'FINAL' }, sendTimeoutMs, { sends: true }), expected)
    },

    /**
     * How a transaction already sent ended, waiting until it's final. For when
     * sending timed out: the transaction may still have gone through.
     */
    async transactionStatus(transactionId: string, senderId: string): Promise<NearTxOutcome> {
      return outcomeOf(await call('tx', { tx_hash: transactionId, sender_account_id: senderId, wait_until: 'FINAL' }, sendTimeoutMs), { transactionId, senderId })
    },
  }
}

export type NearRpc = ReturnType<typeof createNearRpc>
