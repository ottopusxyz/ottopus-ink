import { describe, expect, it } from 'vitest'
import { createSolanaRpc, SOLANA_MAINNET_GENESIS, SolanaRpcError } from './rpc'

/** An RPC that answers each method from `answers`, and says it's on the cluster with `genesis`. */
function fakeFetch(answers: Record<string, unknown>, genesis = SOLANA_MAINNET_GENESIS) {
  const asked: string[] = []
  const fetch = (async (url: string, init: { body: string }) => {
    const { method } = JSON.parse(init.body) as { method: string }
    asked.push(`${url} ${method}`)
    const answer = method === 'getGenesisHash' ? { result: genesis } : answers[method]
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, ...(answer as object) }))
  }) as unknown as typeof globalThis.fetch
  return { fetch, asked }
}

describe('Solana’s RPC', () => {
  it('reads accounts and balances, even ones too big for JSON to carry exactly', async () => {
    const { fetch } = fakeFetch({
      // Above 2^53, as an exchange's wallet can hold: JSON gives it as a number that isn't safe.
      getAccountInfo: { result: { value: { owner: '11111111111111111111111111111111', lamports: 2 ** 53 + 2, data: ['', 'base64'] } } },
      getBalance: { result: { value: 5_000 } },
    })
    const rpc = createSolanaRpc({ fetch, urls: ['https://one'] })
    expect(await rpc.account('x')).toMatchObject({ owner: '11111111111111111111111111111111', data: new Uint8Array(0) })
    expect(await rpc.balance('x')).toBe(5_000n)
  })

  it('uses no RPC on another cluster', async () => {
    const { fetch, asked } = fakeFetch({ getBalance: { result: { value: 1 } } }, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')
    await expect(createSolanaRpc({ fetch, urls: ['https://devnet'] }).balance('x')).rejects.toMatchObject({ reason: 'unavailable' })
    expect(asked).toEqual(['https://devnet getGenesisHash'])
  })

  it('tells a transaction the chain turned away from an RPC that failed, and tries the next on failure', async () => {
    const refused = fakeFetch({ sendTransaction: { error: { code: -32002, message: 'Transaction simulation failed' } } })
    await expect(createSolanaRpc({ fetch: refused.fetch, urls: ['https://one', 'https://two'] }).send(new Uint8Array([1]))).rejects.toEqual(new SolanaRpcError('rejected', 'Transaction simulation failed'))
    expect(refused.asked.filter((each) => each.endsWith('sendTransaction'))).toHaveLength(1)
    const busy = fakeFetch({ sendTransaction: { error: { code: -32005, message: 'Node is behind' } } })
    await expect(createSolanaRpc({ fetch: busy.fetch, urls: ['https://one', 'https://two'] }).send(new Uint8Array([1]))).rejects.toMatchObject({ reason: 'unavailable' })
    expect(busy.asked.filter((each) => each.endsWith('sendTransaction'))).toHaveLength(2)
  })

  it('counts a transaction only once it’s confirmed, and whether it ran without error', async () => {
    const status = (value: unknown) => createSolanaRpc({ fetch: fakeFetch({ getSignatureStatuses: { result: { value: [value] } } }).fetch, urls: ['https://one'] }).status('sig')
    expect(await status(null)).toBeNull()
    expect(await status({ confirmationStatus: 'processed', err: null })).toBeNull()
    expect(await status({ confirmationStatus: 'confirmed', err: null })).toEqual({ ok: true })
    expect(await status({ confirmationStatus: 'finalized', err: { InstructionError: [3, 'Custom'] } })).toEqual({ ok: false })
  })
})
