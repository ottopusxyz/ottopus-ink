import { ed25519 } from '@noble/curves/ed25519.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { base58 } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { decodeSolanaSigned, readsAs, SolanaDecodeError, solanaTransferStep, type SolanaTransfer } from '../shared/solana/transaction'
import { deriveAccounts } from './accounts'
import { signSteps, SignRefusal } from './sign'
import { signSolanaTransfer } from './solana'

// BIP-32 test vector 2's seed: published, and it holds nothing.
const SEED = hexToBytes('fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542')
const FROM = deriveAccounts(SEED).find((account) => account.chain === 'solana')?.address as string
const TO = base58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(9)))
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const LIVE = { recentBlockhash: base58.encode(new Uint8Array(32).fill(3)) }
const USDC_TRANSFER: SolanaTransfer = { from: FROM, to: TO, token: USDC, amount: 6_000_000n, symbol: 'USDC', decimals: 6 }

describe('signing Solana transfers', () => {
  it('signs from the wallet’s own Solana address, and reads back as exactly the step', () => {
    const { signed, transactionId } = signSolanaTransfer(SEED, solanaTransferStep(USDC_TRANSFER), LIVE)
    const read = decodeSolanaSigned(signed)
    expect(readsAs(read, USDC_TRANSFER, LIVE)).toBe(true)
    expect(ed25519.verify(read.signature, read.message, base58.decode(FROM))).toBe(true)
    expect(transactionId).toBe(base58.encode(read.signature))
  })

  it('refuses a step from an address this seed doesn’t hold, or one changed after it was made', () => {
    expect(() => signSolanaTransfer(SEED, solanaTransferStep({ ...USDC_TRANSFER, from: TO, to: FROM }), LIVE)).toThrow(SolanaDecodeError)
    const step = solanaTransferStep(USDC_TRANSFER)
    expect(() => signSolanaTransfer(SEED, { ...step, fields: { ...step.fields, amount: '0' } }, LIVE)).toThrow(SolanaDecodeError)
    expect(() => signSolanaTransfer(SEED, { ...step, fields: { ...step.fields, owner: TO } }, LIVE)).toThrow(SolanaDecodeError)
  })

  it('is reached through signSteps, which refuses live inputs that aren’t a Solana step’s', () => {
    const step = solanaTransferStep(USDC_TRANSFER)
    expect(signSteps(SEED, [step], [LIVE])).toHaveLength(1)
    expect(() => signSteps(SEED, [step], [{ recentBlockhash: 'not-base58!' }])).toThrow(SignRefusal)
    expect(() => signSteps(SEED, [step], [{ nonce: '1', blockHash: '00'.repeat(32) }])).toThrow(SignRefusal)
    expect(() => signSteps(SEED, [solanaTransferStep({ ...USDC_TRANSFER, from: TO, to: FROM })], [LIVE])).toThrow(SignRefusal)
  })
})
