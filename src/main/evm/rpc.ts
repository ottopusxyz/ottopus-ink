import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import type { EvmChain } from '../../shared/evm/chains'

/**
 * Talks to an EVM chain's public RPCs: balances, gas, nonces and fees, sending a signed
 * transaction and reading its receipt. Each RPC is used only once it has said it's on the
 * chain asked for, so an answer from another chain never shapes a transaction. When one
 * RPC fails, the next is tried.
 */

export class EvmRpcError extends Error {
  constructor(
    /** `unavailable`: no RPC answered. `rejected`: the chain turned the request down, such as a transfer that would revert. */
    readonly reason: 'unavailable' | 'rejected',
    message: string,
  ) {
    super(message)
  }
}

export interface EvmCallRequest {
  from: string
  to: string
  value?: bigint
  data?: Uint8Array
}

export interface EvmReceipt {
  ok: boolean
  /** What the transaction paid in fees, in wei: gas used times its price. */
  fee: bigint
}

export interface EvmRpc {
  chain: EvmChain
  balance(address: string): Promise<bigint>
  tokenBalance(token: string, address: string): Promise<bigint>
  decimals(token: string): Promise<number>
  symbol(token: string): Promise<string | null>
  /** The gas a call would use now. `rejected` when it would revert, such as a token transfer the balance can't cover. */
  estimateGas(request: EvmCallRequest): Promise<bigint>
  /** The latest block's base fee and a tip that gets a transaction in soon, wei per unit of gas. */
  fees(): Promise<{ baseFee: bigint; tip: bigint }>
  /** The next nonce, counting transactions still waiting. */
  nonce(address: string): Promise<bigint>
  /** The L1 data fee a rollup adds for a transaction of this many bytes, at most. Zero on chains without one. */
  l1FeeUpperBound(bytes: number): Promise<bigint>
  /** Sends signed bytes. `rejected` when the chain turned them away, so nothing was spent. */
  send(signed: Uint8Array): Promise<string>
  /** The transaction's receipt, or null while it isn't in a block. */
  receipt(hash: string): Promise<EvmReceipt | null>
}

const TIMEOUT_MS = 10_000
const hex = (value: bigint) => `0x${value.toString(16)}`
const word = (address: string) => address.toLowerCase().slice(2).padStart(64, '0')
const quantity = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new EvmRpcError('unavailable', 'not a number')
  return BigInt(value)
}

/** OP Stack chains add an L1 data fee, which their GasPriceOracle prices. */
const OP_STACK = new Set(['base', 'optimism', 'unichain'])
const GAS_PRICE_ORACLE = '0x420000000000000000000000000000000000000F'

/**
 * The least tip Ink offers on a chain whose RPCs suggest one too small to be picked up
 * quickly, in wei per unit of gas: 0.05 gwei on Ethereum, 1 gwei on Gnosis.
 */
const MIN_TIP: Record<string, bigint> = { ethereum: 50_000_000n, gnosis: 1_000_000_000n }

/** Answers that say the chain refused, not that the RPC failed. */
const REFUSALS = /revert|insufficient|nonce|underpriced|exceeds|intrinsic|invalid|already known|replacement/i

export function createEvmRpc(chain: EvmChain, { fetch = globalThis.fetch }: { fetch?: typeof globalThis.fetch } = {}): EvmRpc {
  /** RPCs that said they're on this chain. One that said otherwise is never used. */
  const checked = new Map<string, boolean>()

  const post = async (url: string, method: string, params: unknown[]): Promise<{ result?: unknown; error?: { message?: unknown } }> => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw new Error(`answered ${response.status}`)
    return (await response.json()) as { result?: unknown; error?: { message?: unknown } }
  }

  const onChain = async (url: string): Promise<boolean> => {
    const known = checked.get(url)
    if (known !== undefined) return known
    const answer = await post(url, 'eth_chainId', [])
    const right = typeof answer.result === 'string' && /^0x[0-9a-f]+$/i.test(answer.result) && Number(BigInt(answer.result)) === chain.chainId
    checked.set(url, right)
    return right
  }

  /** One request, to the first RPC on this chain that answers. A refusal from the chain isn't retried elsewhere. */
  async function call(method: string, params: unknown[]): Promise<unknown> {
    let refused: string | null = null
    for (const url of chain.rpcs) {
      try {
        if (!(await onChain(url))) continue
        const answer = await post(url, method, params)
        if (answer.error) {
          const message = typeof answer.error.message === 'string' ? answer.error.message : 'refused'
          if (REFUSALS.test(message)) {
            refused = message
            break
          }
          continue
        }
        return answer.result
      } catch {
        // Down or slow: the next one may answer.
      }
    }
    if (refused !== null) throw new EvmRpcError('rejected', refused)
    throw new EvmRpcError('unavailable', `no ${chain.name} RPC answered`)
  }

  const ethCall = async (to: string, data: string) => {
    const result = await call('eth_call', [{ to, data }, 'latest'])
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]*$/.test(result)) throw new EvmRpcError('unavailable', 'not bytes')
    return result
  }

  return {
    chain,
    balance: async (address) => quantity(await call('eth_getBalance', [address, 'latest'])),
    tokenBalance: async (token, address) => {
      const result = await ethCall(token, `0x70a08231${word(address)}`)
      return result.length >= 66 ? BigInt(result.slice(0, 66)) : 0n
    },
    decimals: async (token) => {
      const result = await ethCall(token, '0x313ce567')
      const value = result.length >= 66 ? BigInt(result.slice(0, 66)) : -1n
      if (value < 0n || value > 36n) throw new EvmRpcError('rejected', 'not a token’s decimals')
      return Number(value)
    },
    symbol: async (token) => {
      // ABI-encoded string: offset, length, then the bytes. Anything else isn't shown.
      const result = await ethCall(token, '0x95d89b41').catch(() => '0x')
      const bytes = hexToBytes(result.slice(2).length % 2 ? '' : result.slice(2))
      if (bytes.length < 96) return null
      const length = Number(BigInt(`0x${bytesToHex(bytes.subarray(32, 64))}`))
      const text = new TextDecoder().decode(bytes.subarray(64, 64 + Math.min(length, 32)))
      return /^[A-Za-z0-9.$+-]{1,16}$/.test(text) ? text : null
    },
    estimateGas: async ({ from, to, value, data }) =>
      quantity(await call('eth_estimateGas', [{ from, to, ...(value !== undefined ? { value: hex(value) } : {}), ...(data ? { data: `0x${bytesToHex(data)}` } : {}) }])),
    fees: async () => {
      const block = (await call('eth_getBlockByNumber', ['latest', false])) as { baseFeePerGas?: unknown } | null
      const baseFee = block && block.baseFeePerGas !== undefined ? quantity(block.baseFeePerGas) : 0n
      const suggested = await call('eth_maxPriorityFeePerGas', [])
        .then(quantity)
        .catch(() => 1_000_000_000n)
      const floor = MIN_TIP[chain.id] ?? 0n
      return { baseFee, tip: suggested > floor ? suggested : floor }
    },
    nonce: async (address) => quantity(await call('eth_getTransactionCount', [address, 'pending'])),
    l1FeeUpperBound: async (bytes) => {
      if (!OP_STACK.has(chain.id)) return 0n
      // getL1FeeUpperBound(uint256 unsignedTxSize)
      const result = await ethCall(GAS_PRICE_ORACLE, `0xf1c7a58b${bytes.toString(16).padStart(64, '0')}`)
      return result.length >= 66 ? BigInt(result.slice(0, 66)) : 0n
    },
    send: async (signed) => {
      const result = await call('eth_sendRawTransaction', [`0x${bytesToHex(signed)}`])
      if (typeof result !== 'string' || !/^0x[0-9a-f]{64}$/i.test(result)) throw new EvmRpcError('unavailable', 'no transaction hash')
      return result.toLowerCase()
    },
    receipt: async (hash) => {
      const result = (await call('eth_getTransactionReceipt', [hash])) as { status?: unknown; gasUsed?: unknown; effectiveGasPrice?: unknown } | null
      if (!result) return null
      return { ok: result.status === '0x1', fee: quantity(result.gasUsed ?? '0x0') * quantity(result.effectiveGasPrice ?? '0x0') }
    },
  }
}
