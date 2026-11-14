import { ed25519 } from '@noble/curves/ed25519.js'
import { base58, base64 } from '@scure/base'
import { describe, expect, it } from 'vitest'
import {
  associatedTokenAccount,
  decodeSolanaSigned,
  readsAs,
  solanaFee,
  SolanaDecodeError,
  solanaMessage,
  solanaSigned,
  solanaTransferOfStep,
  solanaTransferStep,
  type SolanaTransfer,
} from './transaction'

/** Test keys only: 32 bytes of 7s and of 9s. */
const SECRET = new Uint8Array(32).fill(7)
const FROM = base58.encode(ed25519.getPublicKey(SECRET))
const TO = base58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(9)))
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const LIVE = { recentBlockhash: base58.encode(new Uint8Array(32).fill(3)) }
const SOL: SolanaTransfer = { from: FROM, to: TO, token: 'native', amount: 1_234_567n, symbol: 'SOL', decimals: 9 }
const TOKEN: SolanaTransfer = { from: FROM, to: TO, token: USDC, amount: 6_000_000n, symbol: 'USDC', decimals: 6 }

/**
 * The same transfers signed with the key above, as Ink builds them. Each was read back with
 * @solana/web3.js 1.98.4 and @solana/spl-token 0.4.9: the signature verifies, the fee payer
 * is the sender, the compute budget is 10,000 or 80,000 units at 100,000 micro-lamports,
 * and the instructions decode as a system transfer of 1,234,567 lamports, or as the
 * recipient's token account created idempotently (exactly as spl-token builds it) and
 * TransferChecked of 6,000,000 at six decimals between the two associated token accounts.
 */
const SIGNED = {
  native:
    'AQiT2CibdpxiFFfEF/mR//vUyzw1SJx/JLJw6AuEig6rIwqNR/AFhq6IF92+dH6KKoFWcYX9fI3/FnCrN1dFtQsBAAIE6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iz9FyQ4WqDHW2T7eM1gL6HZkf3r92sTxY7XAurINen2GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwZGb+UhFzL/7K26csOb57yM5bvF9xJrLEObOkAAAAADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAAUCECcAAAMACQOghgEAAAAAAAICAAEMAgAAAIfWEgAAAAAA',
  token:
    'AQavWXzyXCc4UckRY8mDgC83+uHBErz7VZQZjyxx+iByxb7W7GncQ8XNiVb0/PfEk1yrxxmSPuX/RAMOsWDzmQ0BAAYJ6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0ixnMC5JGJTXSS6mvk+RTqT0X6FC5kWGfJFkonbV3Xbwdl9k9OMDa6SzFtpT6foxMzDHfd8aVIS7uWOoKIzU4EHm/RckOFqgx1tk+3jNYC+h2ZH96/drE8WO1wLqyDXp9hjG+nrzvtutOj1l82qryXQxsbvkwtL24OR8pgIDRS9dYQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABt324ddloZPZy+FGzut5rBy0he1fWzeROoz1hX7/AKmMlyWPTiSJ8bs9ECkUjg2DC1oTmdr/EIQEjnvY2+n4WQMGRm/lIRcy/+ytunLDm+e8jOW7xfcSayxDmzpAAAAAAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMECAAFAoA4AQAIAAkDoIYBAAAAAAAHBgACAwQFBgEBBgQBBAIACgyAjVsAAAAAAAY=',
}

const sign = (transfer: SolanaTransfer) => {
  const message = solanaMessage(transfer, LIVE)
  return solanaSigned(message, ed25519.sign(message, SECRET))
}

describe('a Solana transfer', () => {
  it('finds associated token accounts as spl-token does', () => {
    expect(associatedTokenAccount(FROM, USDC)).toBe('7woc3ajaGMMXczFYjxon4aQoHH3j126fMUR9c58eHRsK')
    expect(associatedTokenAccount(TO, USDC)).toBe('7RP22uEk2BNSbZaQDPAXEqFzcqgoo7qiDiM3VwpgwXc1')
  })

  it('builds SOL and token transfers byte for byte as checked with Solana’s own libraries', () => {
    expect(base64.encode(sign(SOL).signed)).toBe(SIGNED.native)
    expect(base64.encode(sign(TOKEN).signed)).toBe(SIGNED.token)
    expect(sign(SOL).transactionId).toBe(base58.encode(base64.decode(SIGNED.native).subarray(1, 65)))
  })

  it('reads its own transactions back as exactly the transfer, and nothing else', () => {
    for (const transfer of [SOL, TOKEN]) {
      const read = decodeSolanaSigned(sign(transfer).signed)
      expect(readsAs(read, transfer, LIVE)).toBe(true)
      expect(ed25519.verify(read.signature, read.message, base58.decode(FROM))).toBe(true)
      expect(readsAs(read, { ...transfer, amount: transfer.amount + 1n }, LIVE)).toBe(false)
      expect(readsAs(read, { ...transfer, to: base58.encode(new Uint8Array(32).fill(5)) }, LIVE)).toBe(false)
      expect(readsAs(read, transfer, { recentBlockhash: base58.encode(new Uint8Array(32).fill(4)) })).toBe(false)
    }
    expect(readsAs(decodeSolanaSigned(sign(TOKEN).signed), { ...TOKEN, decimals: 9 }, LIVE)).toBe(false)
    expect(() => decodeSolanaSigned(sign(SOL).signed.subarray(0, 100))).toThrow(SolanaDecodeError)
    expect(() => decodeSolanaSigned(Uint8Array.from([...sign(SOL).signed, 0]))).toThrow(SolanaDecodeError)
  })

  it('keeps a step to one exact form, and refuses what would lose the money', () => {
    expect(solanaTransferOfStep(solanaTransferStep(TOKEN))).toEqual(TOKEN)
    const step = solanaTransferStep(SOL)
    expect(() => solanaTransferOfStep({ ...step, fields: { ...step.fields, amount: '01234567' } })).toThrow(SolanaDecodeError)
    expect(() => solanaTransferOfStep({ ...step, fields: { ...step.fields, memo: 'x' } })).toThrow(SolanaDecodeError)
    expect(() => solanaTransferOfStep({ ...step, chain: 'evm' })).toThrow(SolanaDecodeError)
    expect(() => solanaTransferStep({ ...SOL, to: FROM })).toThrow(SolanaDecodeError)
    expect(() => solanaTransferStep({ ...TOKEN, to: USDC })).toThrow(SolanaDecodeError)
    expect(() => solanaTransferStep({ ...SOL, decimals: 6 })).toThrow(SolanaDecodeError)
    expect(() => solanaTransferStep({ ...SOL, amount: 2n ** 64n })).toThrow(SolanaDecodeError)
    expect(() => solanaTransferStep({ ...SOL, to: '0xBbEC2620Cb01adae3f96e1fa39f997f06BFb7Ca0' })).toThrow(SolanaDecodeError)
  })

  it('costs the signature and a small priority fee, and a token account’s rent when it makes one', () => {
    expect(solanaFee(SOL, false)).toBe(6_000n)
    expect(solanaFee(TOKEN, false)).toBe(13_000n)
    expect(solanaFee(TOKEN, true)).toBe(13_000n + 2_039_280n)
    expect(solanaFee(SOL, true)).toBe(6_000n)
  })
})
