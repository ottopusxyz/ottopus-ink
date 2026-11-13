import { describe, expect, it } from 'vitest'
import { evmChainOf, type EvmChain } from '../../shared/evm/chains'
import { createEvmRpc, EvmRpcError } from './rpc'

const BASE = { ...evmChainOf('base')!, rpcs: ['https://a.test', 'https://b.test'] } as EvmChain
const ETHEREUM = { ...evmChainOf('ethereum')!, rpcs: ['https://a.test'] } as EvmChain

/** RPCs that each answer every method from a table, or fail; `chainId` is what each says it's on. */
function rpcs(answers: Record<string, { chainId?: number; down?: boolean; methods?: Record<string, unknown> }>) {
  const asked: string[] = []
  const fetch = (async (url: string, init?: RequestInit) => {
    const { method } = JSON.parse(String(init?.body)) as { method: string }
    asked.push(`${url} ${method}`)
    const rpc = answers[url]
    if (!rpc || rpc.down) throw new Error('down')
    if (method === 'eth_chainId') return new Response(JSON.stringify({ result: `0x${(rpc.chainId ?? 8453).toString(16)}` }))
    const answer = rpc.methods?.[method]
    return new Response(JSON.stringify(answer && typeof answer === 'object' && 'error' in answer ? answer : { result: answer }))
  }) as unknown as typeof globalThis.fetch
  return { fetch, asked }
}

describe('an EVM chain’s RPCs', () => {
  it('never uses an RPC that says it’s on another chain, and tries the next when one is down', async () => {
    const wrong = rpcs({ 'https://a.test': { chainId: 1, methods: { eth_getBalance: '0x1' } }, 'https://b.test': { methods: { eth_getBalance: '0x2' } } })
    expect(await createEvmRpc(BASE, wrong).balance('0x1111111111111111111111111111111111111111')).toBe(2n)
    expect(wrong.asked).not.toContain('https://a.test eth_getBalance')
    const down = rpcs({ 'https://a.test': { down: true }, 'https://b.test': { methods: { eth_getTransactionCount: '0x7' } } })
    expect(await createEvmRpc(BASE, down).nonce('0x1111111111111111111111111111111111111111')).toBe(7n)
  })

  it('tells a refusal from the chain apart from no answer at all', async () => {
    const refused = rpcs({ 'https://a.test': { methods: { eth_sendRawTransaction: { error: { message: 'nonce too low' } } } } })
    await expect(createEvmRpc(BASE, refused).send(new Uint8Array([2]))).rejects.toMatchObject({ reason: 'rejected' })
    await expect(createEvmRpc(BASE, rpcs({})).send(new Uint8Array([2]))).rejects.toBeInstanceOf(EvmRpcError)
    await expect(createEvmRpc(BASE, rpcs({})).send(new Uint8Array([2]))).rejects.toMatchObject({ reason: 'unavailable' })
  })

  it('reads the base fee and tip, with a floor where the suggested tip is too small to be picked up', async () => {
    const answers = { methods: { eth_getBlockByNumber: { baseFeePerGas: '0x64' }, eth_maxPriorityFeePerGas: '0x16' } }
    expect(await createEvmRpc(BASE, rpcs({ 'https://a.test': answers })).fees()).toEqual({ baseFee: 100n, tip: 22n })
    expect(await createEvmRpc(ETHEREUM, rpcs({ 'https://a.test': { ...answers, chainId: 1 } })).fees()).toEqual({ baseFee: 100n, tip: 50_000_000n })
  })

  it('reads a receipt’s outcome and fee, and a token’s decimals, refusing ones no token has', async () => {
    const rpc = createEvmRpc(BASE, rpcs({ 'https://a.test': { methods: { eth_getTransactionReceipt: { status: '0x0', gasUsed: '0x5208', effectiveGasPrice: '0x2' }, eth_call: `0x${'0'.repeat(62)}ff` } } }))
    expect(await rpc.receipt(`0x${'ab'.repeat(32)}`)).toEqual({ ok: false, fee: 42_000n })
    await expect(rpc.decimals('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')).rejects.toMatchObject({ reason: 'rejected' })
  })
})
