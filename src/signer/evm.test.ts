import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import { decodeEvmSigned, EvmDecodeError, evmSigningHash, evmTransferStep, type EvmLive } from '../shared/evm/transaction'
import { deriveAccounts } from './accounts'
import { signEvmTransfer } from './evm'
import { signSteps, SignRefusal } from './sign'

// BIP-32 test vector 2's seed: published, and it holds nothing.
const SEED = hexToBytes('fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542')
const FROM = '0xBbEC2620Cb01adae3f96e1fa39f997f06BFb7Ca0'
const TO = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const LIVE: EvmLive = { nonce: 7n, maxPriorityFeePerGas: 1_000_000n, maxFeePerGas: 20_000_000n }

// The same transactions, signed by viem 2.21.54 with the same key.
const VIEM_NATIVE =
  '02f87282210507830f42408401312d00825208945aaeb6053f3e94c9b9a09f33669435e7ef1beaed870462d53c88d88080c001a03628574b8f5b3383a48a840100b5cfcaf0197b737b0bd6f88df8e165b45e9676a07f49e00a49945a22e32e28a949b136975b6478a09a1fe3c1b4fc07b182d8025e'
const VIEM_TOKEN =
  '02f8b082210580830f42408401312d0082fde894833589fcd6edb6e08f4c7c32d4f71b54bda0291380b844a9059cbb0000000000000000000000005aaeb6053f3e94c9b9a09f33669435e7ef1beaed0000000000000000000000000000000000000000000000000000000000989680c001a011cd1ee31c503b032a5f10643af8b96f0650827df4da2b0a86c3ba3fb88a6be4a07ae295b2cf572430991008a8ffee24b2b335ad450e4e43f07c035c139f3420e2'

const native = evmTransferStep({ chainId: 8453, from: FROM, to: TO, token: 'native', amount: 1_234_567_890_000_000n, gas: 21_000n, symbol: 'ETH', decimals: 18 })
const token = evmTransferStep({ chainId: 8453, from: FROM, to: TO, token: USDC_BASE, amount: 10_000_000n, gas: 65_000n, symbol: 'USDC', decimals: 6 })

describe('signing EVM transfers', () => {
  it('signs from the wallet’s own EVM address, the one accounts show', () => {
    expect(deriveAccounts(SEED).find((account) => account.chain === 'evm')?.address).toBe(FROM)
  })

  it('gives exactly the signed transaction viem gives for the same coin transfer and key', () => {
    const { signed, transactionId } = signEvmTransfer(SEED, native, LIVE)
    expect(bytesToHex(signed)).toBe(VIEM_NATIVE)
    expect(transactionId).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('gives exactly what viem gives for an ERC-20 transfer, with no coin attached', () => {
    const { signed } = signEvmTransfer(SEED, token, { ...LIVE, nonce: 0n })
    expect(bytesToHex(signed)).toBe(VIEM_TOKEN)
    const read = decodeEvmSigned(signed)
    expect(read).toMatchObject({ chainId: 8453, callee: USDC_BASE, value: 0n, gas: 65_000n })
  })

  it('signs what recovers to the address it spends from', () => {
    const { signed } = signEvmTransfer(SEED, native, LIVE)
    const read = decodeEvmSigned(signed)
    const hash = evmSigningHash({ chainId: 8453, from: FROM, to: TO, token: 'native', amount: 1_234_567_890_000_000n, gas: 21_000n, symbol: 'ETH', decimals: 18 }, LIVE)
    const key = new secp256k1.Signature(read.r, read.s, read.recovery).recoverPublicKey(hash).toBytes(false)
    expect(`0x${bytesToHex(keccak_256(key.subarray(1)).subarray(12))}`).toBe(FROM.toLowerCase())
  })

  it('refuses a step from an address this seed doesn’t hold, or one changed after it was made', () => {
    const other = evmTransferStep({ chainId: 8453, from: TO, to: FROM, token: 'native', amount: 1n, gas: 21_000n, symbol: 'ETH', decimals: 18 })
    expect(() => signEvmTransfer(SEED, other, LIVE)).toThrow(EvmDecodeError)
    expect(() => signEvmTransfer(SEED, { ...native, fields: { ...native.fields, chainId: '99999' } }, LIVE)).toThrow(EvmDecodeError)
    expect(() => signEvmTransfer(SEED, { ...native, fields: { ...native.fields, amount: '0' } }, LIVE)).toThrow(EvmDecodeError)
    expect(() => signEvmTransfer(SEED, { ...native, fields: { ...native.fields, data: '0x' } }, LIVE)).toThrow(EvmDecodeError)
  })

  it('is reached through signSteps, which refuses live inputs that aren’t an EVM step’s', () => {
    expect(signSteps(SEED, [native], [{ nonce: '7', maxFeePerGas: '20000000', maxPriorityFeePerGas: '1000000' }])[0]?.signed).toEqual(hexToBytes(VIEM_NATIVE))
    expect(() => signSteps(SEED, [native], [{ nonce: '7', blockHash: '00'.repeat(32) }])).toThrow(SignRefusal)
    expect(() => signSteps(SEED, [native], [{ nonce: '7', maxFeePerGas: '1', maxPriorityFeePerGas: '2' }])).toThrow(SignRefusal)
    expect(() => signSteps(SEED, [native], [{ nonce: '-1', maxFeePerGas: '2', maxPriorityFeePerGas: '1' }])).toThrow(SignRefusal)
  })
})
