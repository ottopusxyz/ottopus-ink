import { base58, base64 } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { createNearRpc, NearRpcError } from './rpc'

type Reply = { status?: number; body?: unknown; throws?: boolean }

/** A fetch that answers from a script, per URL, and records what was asked. */
function fakeFetch(script: Record<string, Reply[] | ((request: Record<string, unknown>) => Reply)>) {
  const asked: { url: string; request: Record<string, unknown> }[] = []
  const fetch = (async (url: string, init: { body: string }) => {
    const request = JSON.parse(init.body) as Record<string, unknown>
    asked.push({ url, request })
    const entry = script[url]
    const reply = typeof entry === 'function' ? entry(request) : entry?.shift()
    if (!reply || reply.throws) throw new TypeError('fetch failed')
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetch, asked }
}

const A = 'https://a.example'
const B = 'https://b.example'
const rpc = (fetch: typeof globalThis.fetch) => createNearRpc({ urls: [A, B], fetch })
const ok = (result: unknown): Reply => ({ body: { jsonrpc: '2.0', id: '1', result } })
const nearError = (name: string): Reply => ({ body: { jsonrpc: '2.0', id: '1', error: { name: 'HANDLER_ERROR', cause: { name, info: {} }, code: -32000 } } })

/** The shape mainnet sent for `near` on 9 Nov 2026. */
const ACCOUNT = { amount: '69276417285492587988168221648', locked: '0', storage_usage: 182, code_hash: '11111111111111111111111111111111', block_height: 223737468 }
const BLOCK = base58.encode(new Uint8Array(32).fill(3))

describe('the NEAR RPC client', () => {
  it('reads an account’s balance exactly, past what a float could hold', async () => {
    const { fetch, asked } = fakeFetch({ [A]: [ok(ACCOUNT)] })
    expect(await rpc(fetch).viewAccount('near')).toEqual({ amount: 69276417285492587988168221648n, locked: 0n, storageUsage: 182n })
    expect(asked[0]!.request).toMatchObject({ method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: 'near' } })
  })

  it('says null for an account NEAR doesn’t have yet, without asking another RPC', async () => {
    const { fetch, asked } = fakeFetch({ [A]: [nearError('UNKNOWN_ACCOUNT')], [B]: [ok(ACCOUNT)] })
    expect(await rpc(fetch).viewAccount('a'.repeat(64))).toBeNull()
    expect(asked.map(({ url }) => url)).toEqual([A])
  })

  it('moves on to the next RPC when one is down, slow or overloaded', async () => {
    for (const first of [{ throws: true }, { status: 503, body: {} }, nearError('TIMEOUT_ERROR'), { body: 'not json-rpc' }]) {
      const { fetch, asked } = fakeFetch({ [A]: [first], [B]: [ok(ACCOUNT)] })
      expect((await rpc(fetch).viewAccount('near'))?.storageUsage).toBe(182n)
      expect(asked.map(({ url }) => url)).toEqual([A, B])
    }
  })

  it('is unavailable when no RPC answers', async () => {
    const { fetch } = fakeFetch({ [A]: [{ throws: true }], [B]: [{ status: 502, body: {} }] })
    await expect(rpc(fetch).viewAccount('near')).rejects.toMatchObject({ name: 'NearRpcError', reason: 'unavailable' })
  })

  it('takes NEAR’s own error as final', async () => {
    const { fetch, asked } = fakeFetch({ [A]: [nearError('INVALID_TRANSACTION')], [B]: [ok({})] })
    await expect(rpc(fetch).gasPrice()).rejects.toMatchObject({ reason: 'rejected' })
    expect(asked).toHaveLength(1)
  })

  it('refuses a reply that isn’t the shape NEAR sends', async () => {
    for (const bad of [{ ...ACCOUNT, amount: 1.5e28 }, { ...ACCOUNT, amount: '-1' }, { ...ACCOUNT, locked: undefined }, 'account']) {
      const { fetch } = fakeFetch({ [A]: [ok(bad)], [B]: [] })
      await expect(rpc(fetch).viewAccount('near')).rejects.toBeInstanceOf(NearRpcError)
    }
  })

  it('reads an access key’s nonce and the block it came from', async () => {
    const { fetch, asked } = fakeFetch({ [A]: [ok({ nonce: 223737468000004, permission: 'FullAccess', block_hash: BLOCK, block_height: 1 })] })
    expect(await rpc(fetch).viewAccessKey('a'.repeat(64), 'ed25519:abc')).toEqual({ nonce: 223737468000004n, blockHash: new Uint8Array(32).fill(3) })
    expect(asked[0]!.request.params).toMatchObject({ request_type: 'view_access_key', public_key: 'ed25519:abc' })
    // How mainnet says a key is missing, on 9 Nov 2026: a result with an error string, not a JSON-RPC error.
    const missing = { block_hash: BLOCK, block_height: 223739905, error: 'access key ed25519:1111 does not exist while viewing', logs: [] }
    const gone = fakeFetch({ [A]: [ok(missing)], [B]: [] })
    expect(await rpc(gone.fetch).viewAccessKey('a'.repeat(64), 'ed25519:abc')).toBeNull()
    const other = fakeFetch({ [A]: [ok({ ...missing, error: 'something else' })], [B]: [] })
    await expect(rpc(other.fetch).viewAccessKey('a'.repeat(64), 'ed25519:abc')).rejects.toMatchObject({ reason: 'rejected' })
    const short = fakeFetch({ [A]: [ok({ nonce: 1, block_hash: base58.encode(new Uint8Array(31)) })], [B]: [] })
    await expect(rpc(short.fetch).viewAccessKey('a'.repeat(64), 'ed25519:abc')).rejects.toBeInstanceOf(NearRpcError)
  })

  it('reads the gas price', async () => {
    const { fetch } = fakeFetch({ [A]: [ok({ gas_price: '100000000' })] })
    expect(await rpc(fetch).gasPrice()).toBe(100_000_000n)
  })

  it('calls a view method with JSON arguments and parses its JSON result', async () => {
    const { fetch, asked } = fakeFetch({ [A]: [ok({ result: [...new TextEncoder().encode('"34"')], logs: [] })] })
    expect(await rpc(fetch).callView('pool.poolv1.near', 'get_account_total_balance', { account_id: 'root.near' })).toBe('34')
    const params = asked[0]!.request.params as Record<string, string>
    expect(JSON.parse(new TextDecoder().decode(base64.decode(params.args_base64!)))).toEqual({ account_id: 'root.near' })
    const broken = fakeFetch({ [A]: [ok({ error: 'wasm execution failed', logs: [], block_hash: BLOCK })], [B]: [] })
    await expect(rpc(broken.fetch).callView('pool.poolv1.near', 'nope', {})).rejects.toMatchObject({ reason: 'rejected' })
  })

  it('sends a signed transaction, waits for it to be final, and reads how it ended', async () => {
    const success = { status: { SuccessValue: '' }, transaction: { hash: 'TxHash1' }, transaction_outcome: {}, receipts_outcome: [{ outcome: { status: { SuccessValue: '' } } }] }
    const { fetch, asked } = fakeFetch({ [A]: [ok(success)] })
    expect(await rpc(fetch).sendTransaction(Uint8Array.of(1, 2, 3))).toEqual({ transactionId: 'TxHash1', ok: true, failure: null })
    expect(asked[0]!.request).toMatchObject({ method: 'send_tx', params: { signed_tx_base64: 'AQID', wait_until: 'FINAL' } })
  })

  it('counts a transaction as failed when it or any receipt failed', async () => {
    const failed = { status: { Failure: { ActionError: { kind: { AccountDoesNotExist: { account_id: 'nobody.near' } } } } }, transaction: { hash: 'TxHash2' }, receipts_outcome: [] }
    const receiptFailed = { status: { SuccessValue: '' }, transaction: { hash: 'TxHash3' }, receipts_outcome: [{ outcome: { status: { Failure: { x: 1 } } } }] }
    const { fetch } = fakeFetch({ [A]: [ok(failed), ok(receiptFailed)] })
    const one = await rpc(fetch).sendTransaction(Uint8Array.of(1))
    expect(one).toMatchObject({ transactionId: 'TxHash2', ok: false })
    expect(one.failure).toContain('AccountDoesNotExist')
    expect(await rpc(fetch).sendTransaction(Uint8Array.of(1))).toMatchObject({ transactionId: 'TxHash3', ok: false })
  })

  it('looks up a transaction that was already sent', async () => {
    const { fetch, asked } = fakeFetch({ [A]: [ok({ status: { SuccessValue: '' }, transaction: { hash: 'TxHash4' }, receipts_outcome: [] })] })
    expect(await rpc(fetch).transactionStatus('TxHash4', 'a'.repeat(64))).toMatchObject({ ok: true })
    expect(asked[0]!.request).toMatchObject({ method: 'tx', params: { tx_hash: 'TxHash4', sender_account_id: 'a'.repeat(64), wait_until: 'FINAL' } })
  })
})
