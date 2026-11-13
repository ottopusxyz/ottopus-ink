import { describe, expect, it } from 'vitest'
import type { Account } from '../../shared/accounts'
import { evmChainOf } from '../../shared/evm/chains'
import { evmTransferOfStep } from '../../shared/evm/transaction'
import type { PlanIntent } from '../../shared/plan'
import type { OneClickToken } from '../routes/one-click'
import { buildEvmSend, evmSendFees, isEvmSend } from './build'
import { EvmRpcError, type EvmRpc } from './rpc'

const FROM = '0xBbEC2620Cb01adae3f96e1fa39f997f06BFb7Ca0'
const TO = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const OWN: Account[] = [{ chain: 'evm', path: "m/44'/60'/0'/0/0", address: FROM }]
const TOKENS: OneClickToken[] = [
  { assetId: 'nep141:base-usdc.omft.near', symbol: 'USDC', decimals: 6, blockchain: 'base', contract: USDC, usd: 1 },
  { assetId: 'nep141:base.omft.near', symbol: 'ETH', decimals: 18, blockchain: 'base', contract: null, usd: 3000 },
]
const SEND: PlanIntent = { outcome: 'send', asset: 'USDC', amount: '10', chain: 'base', to: TO, toAsset: null, toChain: null }

/** A chain where the address holds `coin` wei and `tokens` of USDC, the base fee is 0.01 gwei and the tip 0.001 gwei. */
function fakeRpc({ coin = 10n ** 16n, tokens = 50_000_000n, decimals = 6, estimate = 50_000n, refuse = false } = {}): EvmRpc & { estimated: unknown[] } {
  const estimated: unknown[] = []
  return {
    chain: evmChainOf('base')!,
    estimated,
    balance: async () => coin,
    tokenBalance: async () => tokens,
    decimals: async () => decimals,
    symbol: async () => 'USDC',
    estimateGas: async (request) => {
      estimated.push(request)
      if (refuse) throw new EvmRpcError('rejected', 'execution reverted: transfer amount exceeds balance')
      return estimate
    },
    fees: async () => ({ baseFee: 10_000_000n, tip: 1_000_000n }),
    nonce: async () => 3n,
    l1FeeUpperBound: async () => 1_000n,
    send: async () => `0x${'ab'.repeat(32)}`,
    receipt: async () => ({ ok: true, fee: 1n }),
  }
}

const build = (intent: PlanIntent, rpc: EvmRpc, tokens: OneClickToken[] | null = TOKENS) => buildEvmSend(intent, OWN, { rpcFor: () => rpc, tokens: async () => tokens })

describe('building an EVM send', () => {
  it('sends a token 1Click lists there, at its own decimals, with the gas estimated and room to spare', async () => {
    const rpc = fakeRpc()
    const built = await build(SEND, rpc)
    if (!built.ok) throw new Error(built.reason)
    expect(evmTransferOfStep(built.steps[0]!)).toEqual({ chainId: 8453, from: FROM, to: TO, token: USDC, amount: 10_000_000n, gas: 60_000n, symbol: 'USDC', decimals: 6 })
    expect(rpc.estimated).toHaveLength(1)
  })

  it('sends the chain’s own coin by its symbol, or a token by its contract, on chains by any of their names', async () => {
    const coin = await build({ ...SEND, asset: 'ETH', amount: '0.001' }, fakeRpc())
    if (!coin.ok) throw new Error(coin.reason)
    // A plain transfer's gas is never below 21,000.
    expect(evmTransferOfStep(coin.steps[0]!)).toMatchObject({ token: 'native', amount: 10n ** 15n, gas: 60_000n, symbol: 'ETH', decimals: 18 })
    const byContract = await build({ ...SEND, asset: USDC }, fakeRpc(), null)
    expect(byContract.ok && evmTransferOfStep(byContract.steps[0]!).symbol).toBe('USDC')
    const bnb = await buildEvmSend({ ...SEND, asset: 'BNB', chain: 'BNB Chain', amount: '0.001' }, OWN, { rpcFor: (chain) => ({ ...fakeRpc(), chain }), tokens: async () => [] })
    expect(bnb.ok && evmTransferOfStep(bnb.steps[0]!)).toMatchObject({ chainId: 56, token: 'native', symbol: 'BNB' })
  })

  it('refuses what the balance can’t cover, with the fees, and a token the chain says would revert', async () => {
    expect(await build(SEND, fakeRpc({ tokens: 9_000_000n }))).toEqual({ ok: false, reason: 'insufficient-funds' })
    expect(await build(SEND, fakeRpc({ coin: 0n }))).toEqual({ ok: false, reason: 'insufficient-funds' })
    expect(await build(SEND, fakeRpc({ refuse: true }))).toEqual({ ok: false, reason: 'insufficient-funds' })
  })

  it('refuses a token the chain disagrees about, one it doesn’t know, and a recipient that isn’t an address', async () => {
    expect(await build(SEND, fakeRpc({ decimals: 18 }))).toEqual({ ok: false, reason: 'chain-unavailable' })
    expect(await build({ ...SEND, asset: 'DOGWIFHAT' }, fakeRpc())).toEqual({ ok: false, reason: 'no-route' })
    expect(await build({ ...SEND, to: 'alice.near' }, fakeRpc())).toEqual({ ok: false, reason: 'bad-address' })
    expect(await build({ ...SEND, to: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAEd' }, fakeRpc())).toEqual({ ok: false, reason: 'bad-address' })
  })

  it('knows which intents are EVM sends', () => {
    expect(isEvmSend(SEND)).toBe(true)
    expect(isEvmSend({ ...SEND, chain: 'arb' })).toBe(true)
    expect(isEvmSend({ ...SEND, chain: 'near' })).toBe(false)
    expect(isEvmSend({ ...SEND, outcome: 'swap' })).toBe(false)
  })

  it('caps fees at twice today’s base fee plus the tip, and counts a rollup’s L1 fee', async () => {
    expect(await evmSendFees(fakeRpc(), 60_000n)).toEqual({ maxFeePerGas: 21_000_000n, maxPriorityFeePerGas: 1_000_000n, ceiling: 60_000n * 21_000_000n + 1_000n })
  })
})
