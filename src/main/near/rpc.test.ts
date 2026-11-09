import { base58, base64 } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { encodeSignedTransaction, encodeTransfer, NearDecodeError, transactionId } from '../../shared/near/transaction'
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
/** The parts of mainnet's protocol config (protocol 88) a transfer's fees come from, as sent on 9 Nov 2026. */
const PROTOCOL_CONFIG = {
  protocol_version: 88,
  runtime_config: {
    account_creation_charge: '7000000000000000000000',
    min_gas_purchase_price: '1000000000',
    storage_amount_per_byte: '10000000000000000000',
    transaction_costs: {
      action_receipt_creation_config: { execution: 108059500000, send_not_sir: 108059500000, send_sir: 108059500000 },
      action_creation_config: {
        create_account_cost: { execution: 7200000000000, send_not_sir: 500000000000, send_sir: 500000000000 },
        transfer_cost: { execution: 115123062500, send_not_sir: 115123062500, send_sir: 115123062500 },
        add_key_cost: {
          full_access_cost: { execution: 101765125000, send_not_sir: 101765125000, send_sir: 101765125000 },
          function_call_cost: { execution: 102217625000, send_not_sir: 102217625000, send_sir: 102217625000 },
        },
      },
    },
  },
}
const BLOCK = base58.encode(new Uint8Array(32).fill(3))

const SENDER = 'a'.repeat(64)
const UNSIGNED = encodeTransfer({ signerId: SENDER, publicKey: new Uint8Array(32).fill(1), nonce: 7n, receiverId: 'alice.near', blockHash: new Uint8Array(32).fill(3), deposit: 1n })
const SIGNED = encodeSignedTransaction(UNSIGNED, new Uint8Array(64))
const TX_ID = transactionId(UNSIGNED)

/** A final outcome for SIGNED, shaped as mainnet sends one, with any part changed. */
const outcome = (change: Record<string, unknown> = {}) => ({
  status: { SuccessValue: '' },
  transaction: { hash: TX_ID, signer_id: SENDER, receiver_id: 'alice.near', nonce: 7 },
  transaction_outcome: { id: TX_ID, outcome: { status: { SuccessReceiptId: 'R1' }, executor_id: SENDER } },
  receipts_outcome: [{ id: 'R1', outcome: { status: { SuccessValue: '' }, executor_id: 'alice.near' } }],
  ...change,
})

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

  it('reads which network the RPC is on', async () => {
    const { fetch, asked } = fakeFetch({ [A]: [ok({ chain_id: 'testnet', genesis_hash: BLOCK }), ok({})] })
    const client = rpc(fetch)
    expect(await client.chainId()).toBe('testnet')
    expect(asked[0]?.request).toMatchObject({ method: 'status', params: [] })
    await expect(client.chainId()).rejects.toMatchObject({ reason: 'unavailable' })
  })

  it('reads the gas price', async () => {
    const { fetch } = fakeFetch({ [A]: [ok({ gas_price: '100000000' })] })
    expect(await rpc(fetch).gasPrice()).toBe(100_000_000n)
  })

  it('reads the fees a transfer pays from the protocol config', async () => {
    const { fetch, asked } = fakeFetch({ [A]: [ok(PROTOCOL_CONFIG)] })
    expect(await rpc(fetch).protocolFees()).toEqual({
      minGasPurchasePrice: 1_000_000_000n,
      receipt: { send: 108_059_500_000n, exec: 108_059_500_000n },
      transfer: { send: 115_123_062_500n, exec: 115_123_062_500n },
      createAccount: { send: 500_000_000_000n, exec: 7_200_000_000_000n },
      addFullAccessKey: { send: 101_765_125_000n, exec: 101_765_125_000n },
    })
    expect(asked[0]!.request).toMatchObject({ method: 'EXPERIMENTAL_protocol_config', params: { finality: 'final' } })
  })

  it('refuses a protocol config missing a fee, rather than guessing it', async () => {
    const runtime = PROTOCOL_CONFIG.runtime_config
    const without = (change: Record<string, unknown>) => ({ ...PROTOCOL_CONFIG, runtime_config: { ...runtime, ...change } })
    for (const config of [without({ min_gas_purchase_price: undefined }), without({ min_gas_purchase_price: '-1' }), without({ transaction_costs: {} }), {}]) {
      const { fetch } = fakeFetch({ [A]: [ok(config)] })
      await expect(rpc(fetch).protocolFees()).rejects.toMatchObject({ reason: 'unavailable' })
    }
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
    const { fetch, asked } = fakeFetch({ [A]: [ok(outcome())] })
    expect(await rpc(fetch).sendTransaction(SIGNED)).toEqual({ transactionId: TX_ID, ok: true, failure: null })
    expect(asked[0]!.request).toMatchObject({ method: 'send_tx', params: { signed_tx_base64: base64.encode(SIGNED), wait_until: 'FINAL' } })
  })

  it('takes NEAR’s error on a send as final only if no earlier RPC could have taken it', async () => {
    const { fetch } = fakeFetch({ [A]: [nearError('INVALID_TRANSACTION')], [B]: [] })
    await expect(rpc(fetch).sendTransaction(SIGNED)).rejects.toMatchObject({ reason: 'rejected' })
    // The first RPC may have sent it before its answer was lost, so the second's error says nothing about it.
    for (const first of [{ throws: true }, { status: 503, body: {} }, nearError('TIMEOUT_ERROR'), { body: 'not json-rpc' }]) {
      for (const second of [nearError('INVALID_TRANSACTION'), nearError('UNKNOWN_ACCOUNT')]) {
        const { fetch, asked } = fakeFetch({ [A]: [first], [B]: [second] })
        await expect(rpc(fetch).sendTransaction(SIGNED)).rejects.toMatchObject({ reason: 'unavailable' })
        expect(asked.map(({ url }) => url)).toEqual([A, B])
      }
    }
    // Its outcome after a lost answer is still read as usual.
    const { fetch: recovered } = fakeFetch({ [A]: [{ throws: true }], [B]: [ok(outcome())] })
    expect(await rpc(recovered).sendTransaction(SIGNED)).toMatchObject({ ok: true })
  })

  it('takes a later RPC’s error as final for anything but a send', async () => {
    const { fetch } = fakeFetch({ [A]: [{ throws: true }], [B]: [nearError('INVALID_TRANSACTION')] })
    await expect(rpc(fetch).gasPrice()).rejects.toMatchObject({ reason: 'rejected' })
  })

  it('won’t send bytes that aren’t a signed transfer', async () => {
    const { fetch, asked } = fakeFetch({ [A]: [ok(outcome())] })
    await expect(rpc(fetch).sendTransaction(Uint8Array.of(1, 2, 3))).rejects.toBeInstanceOf(NearDecodeError)
    expect(asked).toEqual([])
  })

  it('counts a transaction as failed when it or any receipt failed', async () => {
    const failure = { Failure: { ActionError: { kind: { AccountDoesNotExist: { account_id: 'nobody.near' } } } } }
    const failed = outcome({ status: failure })
    const receiptFailed = outcome({ receipts_outcome: [{ id: 'R1', outcome: { status: { SuccessValue: '' } } }, { id: 'R2', outcome: { status: { Failure: { x: 1 } } } }] })
    const { fetch } = fakeFetch({ [A]: [ok(failed), ok(receiptFailed)] })
    const one = await rpc(fetch).sendTransaction(SIGNED)
    expect(one).toMatchObject({ transactionId: TX_ID, ok: false })
    expect(one.failure).toContain('AccountDoesNotExist')
    expect(await rpc(fetch).sendTransaction(SIGNED)).toMatchObject({ transactionId: TX_ID, ok: false })
  })

  it('looks up a transaction that was already sent', async () => {
    const { fetch, asked } = fakeFetch({ [A]: [ok(outcome())] })
    expect(await rpc(fetch).transactionStatus(TX_ID, SENDER)).toEqual({ transactionId: TX_ID, ok: true, failure: null })
    expect(asked[0]!.request).toMatchObject({ method: 'tx', params: { tx_hash: TX_ID, sender_account_id: SENDER, wait_until: 'FINAL' } })
  })

  it('refuses the outcome of another transaction, or of another sender', async () => {
    const other = base58.encode(new Uint8Array(32).fill(5))
    for (const wrong of [
      outcome({ transaction: { hash: other, signer_id: SENDER } }),
      outcome({ transaction: { hash: TX_ID, signer_id: 'mallory.near' } }),
      outcome({ transaction_outcome: { id: other, outcome: { status: { SuccessReceiptId: 'R1' } } } }),
    ]) {
      const send = fakeFetch({ [A]: [ok(wrong)], [B]: [] })
      await expect(rpc(send.fetch).sendTransaction(SIGNED)).rejects.toMatchObject({ reason: 'unavailable' })
      const look = fakeFetch({ [A]: [ok(wrong)], [B]: [] })
      await expect(rpc(look.fetch).transactionStatus(TX_ID, SENDER)).rejects.toMatchObject({ reason: 'unavailable' })
    }
  })

  it('refuses an outcome that isn’t complete, rather than call it a success', async () => {
    for (const partial of [
      outcome({ receipts_outcome: [] }),
      outcome({ receipts_outcome: undefined }),
      outcome({ receipts_outcome: [{ id: 'R1', outcome: { status: 'Unknown' } }] }),
      outcome({ receipts_outcome: [{ id: 'R1', outcome: { status: { SuccessValue: '' } } }, { id: 'R2', outcome: {} }] }),
      outcome({ transaction_outcome: { id: TX_ID, outcome: { status: 'Unknown' } } }),
      outcome({ transaction_outcome: undefined }),
      outcome({ status: 'NotStarted' }),
      outcome({ status: {} }),
    ]) {
      const { fetch } = fakeFetch({ [A]: [ok(partial)], [B]: [] })
      await expect(rpc(fetch).transactionStatus(TX_ID, SENDER)).rejects.toMatchObject({ reason: 'unavailable' })
    }
  })
})
