import { describe, expect, it } from 'vitest'
import { EVM_CHAINS, evmChainOf } from './chains'
import { decodeEvmSigned, EvmDecodeError, evmTransferOfStep, evmTransferStep, type EvmTransfer } from './transaction'

const TRANSFER: EvmTransfer = {
  chainId: 8453,
  from: '0xBbEC2620Cb01adae3f96e1fa39f997f06BFb7Ca0',
  to: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  amount: 10_000_000n,
  gas: 60_000n,
  symbol: 'USDC',
  decimals: 6,
}

describe('an EVM transfer step', () => {
  it('reads back exactly as it was written', () => {
    expect(evmTransferOfStep(evmTransferStep(TRANSFER))).toEqual(TRANSFER)
  })

  it('refuses a step Ink didn’t write, or one that could only lose funds', () => {
    const step = evmTransferStep(TRANSFER)
    const changed = (fields: Record<string, string>) => () => evmTransferOfStep({ ...step, fields: { ...step.fields, ...fields } })
    const bads: Record<string, string>[] = [{ chainId: '1337' }, { amount: '0' }, { amount: '010' }, { gas: '20999' }, { to: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAEd' }, { token: TRANSFER.to.toLowerCase() }, { symbol: 'Claim at evil.test' }, { decimals: '37' }]
    for (const bad of bads) {
      expect(changed(bad)).toThrow(EvmDecodeError)
    }
    expect(() => evmTransferOfStep({ ...step, fields: { ...step.fields, data: '0x' } })).toThrow(EvmDecodeError)
    expect(() => evmTransferOfStep({ ...step, chain: 'near' })).toThrow(EvmDecodeError)
    // A token address is kept in one case only, so two spellings never hash differently.
    expect(changed({ token: '0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913' })).toThrow(EvmDecodeError)
  })

  it('reads only typed EIP-1559 transactions with no access list', () => {
    expect(() => decodeEvmSigned(new Uint8Array([0xf8, 0x00]))).toThrow(EvmDecodeError)
    expect(() => decodeEvmSigned(new Uint8Array([0x02, 0xc0]))).toThrow(EvmDecodeError)
  })
})

describe('the EVM chains', () => {
  it('each have a distinct chain id and at least one RPC, and answer to common names', () => {
    expect(new Set(EVM_CHAINS.map((chain) => chain.chainId)).size).toBe(EVM_CHAINS.length)
    expect(EVM_CHAINS.every((chain) => chain.rpcs.length > 0 && chain.rpcs.every((url) => url.startsWith('https://')))).toBe(true)
    expect(evmChainOf('BNB Chain')?.chainId).toBe(56)
    expect(evmChainOf('arb')?.chainId).toBe(42161)
    expect(evmChainOf('solana')).toBeNull()
  })
})
