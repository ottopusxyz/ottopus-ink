import { base64 } from '@scure/base'

/**
 * Talks to Solana mainnet's public RPCs: balances, accounts, a recent blockhash, sending a
 * signed transaction and reading its status. Each RPC is used only once it has said it's
 * on mainnet, by its genesis hash, so an answer from another cluster never shapes a
 * transaction. When one RPC fails, the next is tried.
 */

export class SolanaRpcError extends Error {
  constructor(
    /** `unavailable`: no RPC answered. `rejected`: the chain turned the transaction down before it ran, so nothing was spent. */
    readonly reason: 'unavailable' | 'rejected',
    message: string,
  ) {
    super(message)
  }
}

/** An account as the chain holds it: its owner program, its lamports and its data. */
export interface SolanaAccount {
  owner: string
  lamports: bigint
  data: Uint8Array
}

export interface SolanaRpc {
  /** Lamports at an address; zero when there's no account. */
  balance(address: string): Promise<bigint>
  /** The account at an address, or null when there's none. */
  account(address: string): Promise<SolanaAccount | null>
  /** A blockhash to build on, and the last block height a transaction naming it can land in. */
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint }>
  blockHeight(): Promise<bigint>
  /** Sends signed bytes, after the RPC simulates them. `rejected` when the chain turned them away. */
  send(signed: Uint8Array): Promise<string>
  /** Where a transaction stands: null while the chain doesn't show it, else whether it ran without error once confirmed. */
  status(signature: string): Promise<{ ok: boolean } | null>
}

/** Solana mainnet-beta's genesis hash. */
export const SOLANA_MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
export const SOLANA_RPCS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']
const TIMEOUT_MS = 15_000
/** Errors that say the chain refused the transaction: its simulation failed, or its signature or blockhash didn't check out. */
const REFUSAL_CODES = new Set([-32002, -32003])
const COMMITMENT = { commitment: 'confirmed' }

/**
 * A whole number as the RPC writes it, in JSON. Above 2^53 (some 9 million SOL in lamports,
 * which exchanges' wallets hold) JSON can't carry it exactly; it's then off by a few
 * lamports at most, which no check here turns on.
 */
const whole = (value: unknown): bigint => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new SolanaRpcError('unavailable', 'not a whole number')
  return BigInt(value)
}

export function createSolanaRpc({ fetch = globalThis.fetch, urls = SOLANA_RPCS }: { fetch?: typeof globalThis.fetch; urls?: readonly string[] } = {}): SolanaRpc {
  /** RPCs that said they're on mainnet. One that said otherwise is never used. */
  const checked = new Map<string, boolean>()

  const post = async (url: string, method: string, params: unknown[]): Promise<{ result?: unknown; error?: { code?: unknown; message?: unknown } }> => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw new Error(`answered ${response.status}`)
    return (await response.json()) as { result?: unknown; error?: { code?: unknown; message?: unknown } }
  }

  const onMainnet = async (url: string): Promise<boolean> => {
    const known = checked.get(url)
    if (known !== undefined) return known
    const answer = await post(url, 'getGenesisHash', [])
    const right = answer.result === SOLANA_MAINNET_GENESIS
    checked.set(url, right)
    return right
  }

  /** One request, to the first mainnet RPC that answers. A refusal from the chain isn't retried elsewhere. */
  async function call(method: string, params: unknown[]): Promise<unknown> {
    for (const url of urls) {
      let answer: Awaited<ReturnType<typeof post>>
      try {
        if (!(await onMainnet(url))) continue
        answer = await post(url, method, params)
      } catch {
        // Down or slow: the next one may answer.
        continue
      }
      if (answer.error) {
        const message = typeof answer.error.message === 'string' ? answer.error.message : 'refused'
        if (typeof answer.error.code === 'number' && REFUSAL_CODES.has(answer.error.code)) throw new SolanaRpcError('rejected', message)
        continue
      }
      return answer.result
    }
    throw new SolanaRpcError('unavailable', 'no Solana RPC answered')
  }

  return {
    balance: async (address) => whole(((await call('getBalance', [address, COMMITMENT])) as { value?: unknown } | null)?.value),
    async account(address) {
      const result = (await call('getAccountInfo', [address, { ...COMMITMENT, encoding: 'base64' }])) as { value?: unknown } | null
      const value = result?.value as { owner?: unknown; lamports?: unknown; data?: unknown } | null | undefined
      if (value === null) return null
      if (!value || typeof value.owner !== 'string' || !Array.isArray(value.data) || typeof value.data[0] !== 'string' || value.data[1] !== 'base64') throw new SolanaRpcError('unavailable', 'not an account')
      return { owner: value.owner, lamports: whole(value.lamports), data: base64.decode(value.data[0]) }
    },
    async latestBlockhash() {
      const value = ((await call('getLatestBlockhash', [COMMITMENT])) as { value?: { blockhash?: unknown; lastValidBlockHeight?: unknown } } | null)?.value
      if (!value || typeof value.blockhash !== 'string') throw new SolanaRpcError('unavailable', 'no blockhash')
      return { blockhash: value.blockhash, lastValidBlockHeight: whole(value.lastValidBlockHeight) }
    },
    blockHeight: async () => whole(await call('getBlockHeight', [COMMITMENT])),
    async send(signed) {
      const result = await call('sendTransaction', [base64.encode(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }])
      if (typeof result !== 'string') throw new SolanaRpcError('unavailable', 'no signature')
      return result
    },
    async status(signature) {
      const value = ((await call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])) as { value?: unknown[] } | null)?.value
      const status = value?.[0] as { err?: unknown; confirmationStatus?: unknown } | null | undefined
      if (!status || (status.confirmationStatus !== 'confirmed' && status.confirmationStatus !== 'finalized')) return null
      return { ok: status.err === null || status.err === undefined }
    },
  }
}
