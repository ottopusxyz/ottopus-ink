import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import * as near from 'near-api-js'
import { describe, expect, it } from 'vitest'
import {
  decodeTransfer,
  encodeSignedTransaction,
  encodeTransfer,
  NearDecodeError,
  nearPublicKey,
  nearTransferStep,
  parseNearPublicKey,
  transactionHash,
  transactionId,
  transferOfStep,
  type NearTransfer,
} from './transaction'

/** near-api-js is the reference: it is only used here, never by the app. */
const reference = (transfer: NearTransfer, actions = [near.actions.transfer(transfer.deposit)]) =>
  near.createTransaction(transfer.signerId, near.PublicKey.fromString(nearPublicKey(transfer.publicKey)), transfer.receiverId, transfer.nonce, actions, transfer.blockHash)

const hex = bytesToHex
const randomBytes = (size: number) => crypto.getRandomValues(new Uint8Array(size))
const randomBig = (size: number) => BigInt(`0x${hex(randomBytes(size))}`)

const SAMPLE: NearTransfer = {
  signerId: '06b66cee83c72cf7462ac756b159664732607df5bf254e589426b7e4b4f9d60d',
  publicKey: hexToBytes('06b66cee83c72cf7462ac756b159664732607df5bf254e589426b7e4b4f9d60d'),
  nonce: 223_737_468_000_001n,
  receiverId: 'alice.near',
  blockHash: new Uint8Array(32).fill(9),
  deposit: 1_500_000_000_000_000_000_000_000n,
}

function randomTransfer(i: number): NearTransfer {
  const ids = ['alice.near', 'a'.repeat(64), `0x${'1'.repeat(40)}`, 'app.bob-1.near', 'near', 'x_y.tg']
  return {
    signerId: hex(randomBytes(32)),
    publicKey: randomBytes(32),
    nonce: randomBig(8),
    receiverId: ids[i % ids.length]!,
    blockHash: randomBytes(32),
    deposit: randomBig(16),
  }
}

describe('encoding a NEAR transfer', () => {
  it('writes the same bytes as near-api-js, for 500 random transfers', () => {
    for (let i = 0; i < 500; i++) {
      const transfer = randomTransfer(i)
      expect(hex(encodeTransfer(transfer))).toBe(hex(near.encodeTransaction(reference(transfer))))
    }
  })

  it('reads near-api-js’s bytes back to the same fields', () => {
    for (let i = 0; i < 100; i++) {
      const transfer = randomTransfer(i)
      expect(decodeTransfer(near.encodeTransaction(reference(transfer)))).toEqual(transfer)
    }
  })

  it('hashes the transaction as near-api-js does when it signs', async () => {
    const pair = near.KeyPair.fromRandom('ed25519')
    const transfer = { ...SAMPLE, publicKey: pair.getPublicKey().data }
    const { txHash: hash } = await new near.KeyPairSigner(pair).signTransaction(reference(transfer))
    const bytes = encodeTransfer(transfer)
    expect(hex(transactionHash(bytes))).toBe(hex(hash))
    // That hash in base58 is the id explorers show.
    expect(transactionId(bytes)).toBe(near.baseEncode(hash))
  })

  it('writes a signed transaction as near-api-js does', () => {
    const bytes = encodeTransfer(SAMPLE)
    const signature = randomBytes(64)
    const signed = new near.SignedTransaction({ transaction: reference(SAMPLE), signature: new near.Signature({ keyType: 0, data: signature }) })
    expect(hex(encodeSignedTransaction(bytes, signature))).toBe(hex(signed.encode()))
    expect(() => encodeSignedTransaction(bytes, new Uint8Array(63))).toThrow(NearDecodeError)
  })
})

describe('decoding refuses anything Ink doesn’t send', () => {
  const refuse = (bytes: Uint8Array) => expect(() => decodeTransfer(bytes)).toThrow(NearDecodeError)

  it('another action, or more than one', () => {
    refuse(near.encodeTransaction(reference(SAMPLE, [near.actions.functionCall('ft_transfer', {}, 30_000_000_000_000n, 1n)])))
    refuse(near.encodeTransaction(reference(SAMPLE, [near.actions.deleteAccount('mallory.near')])))
    refuse(near.encodeTransaction(reference(SAMPLE, [near.actions.transfer(1n), near.actions.transfer(1n)])))
    refuse(near.encodeTransaction(reference(SAMPLE, [])))
  })

  it('a key that isn’t ed25519', () => {
    const bytes = encodeTransfer(SAMPLE)
    const tampered = Uint8Array.from(bytes)
    tampered[4 + SAMPLE.signerId.length] = 1
    refuse(tampered)
  })

  it('bytes after the end, or bytes missing', () => {
    const bytes = encodeTransfer(SAMPLE)
    refuse(Uint8Array.from([...bytes, 0]))
    refuse(bytes.subarray(0, bytes.length - 1))
    refuse(new Uint8Array(0))
  })

  it('an account id that NEAR wouldn’t accept, or isn’t UTF-8', () => {
    const bytes = encodeTransfer(SAMPLE)
    const upper = Uint8Array.from(bytes)
    upper[4 + SAMPLE.signerId.length + 1 + 32 + 8 + 4] = 'A'.charCodeAt(0)
    refuse(upper)
    const notUtf8 = Uint8Array.from(bytes)
    notUtf8[4 + SAMPLE.signerId.length + 1 + 32 + 8 + 4] = 0xff
    refuse(notUtf8)
  })

  it('an account id behind a UTF-8 byte order mark, which a lenient decoder would drop', () => {
    const BOM = [0xef, 0xbb, 0xbf]
    const withBom = (id: string) => Uint8Array.from([id.length + 3, 0, 0, 0, ...BOM, ...new TextEncoder().encode(id)])
    const bytes = encodeTransfer({ ...SAMPLE, signerId: 'bb', receiverId: 'cc' })
    // signer: u32 length + 'bb', then key, nonce; receiver: u32 length + 'cc', then the rest.
    const receiverAt = 4 + 2 + 1 + 32 + 8
    refuse(Uint8Array.from([...withBom('bb'), ...bytes.subarray(6)]))
    refuse(Uint8Array.from([...bytes.subarray(0, receiverAt), ...withBom('cc'), ...bytes.subarray(receiverAt + 6)]))
    // The same bytes without the mark do read.
    expect(decodeTransfer(bytes)).toMatchObject({ signerId: 'bb', receiverId: 'cc' })
  })

  it('and won’t encode one either', () => {
    expect(() => encodeTransfer({ ...SAMPLE, receiverId: 'Mallory.near' })).toThrow(NearDecodeError)
    expect(() => encodeTransfer({ ...SAMPLE, deposit: -1n })).toThrow(NearDecodeError)
    expect(() => encodeTransfer({ ...SAMPLE, deposit: 1n << 128n })).toThrow(NearDecodeError)
    expect(() => encodeTransfer({ ...SAMPLE, nonce: 1n << 64n })).toThrow(NearDecodeError)
    expect(() => encodeTransfer({ ...SAMPLE, blockHash: new Uint8Array(31) })).toThrow(NearDecodeError)
  })
})

describe('a plan step for a NEAR transfer', () => {
  const fields = { signerId: SAMPLE.signerId, publicKey: nearPublicKey(SAMPLE.publicKey), receiverId: 'alice.near', deposit: SAMPLE.deposit.toString() }
  const live = { nonce: SAMPLE.nonce, blockHash: SAMPLE.blockHash }

  it('holds only strings and becomes the transfer once the nonce and block hash are known', () => {
    const step = nearTransferStep(fields)
    expect(Object.values(step.fields).every((value) => typeof value === 'string')).toBe(true)
    expect(transferOfStep(step, live)).toEqual(SAMPLE)
  })

  it('writes public keys as near-api-js does, and reads them back', () => {
    expect(nearPublicKey(SAMPLE.publicKey)).toBe(near.PublicKey.fromString(nearPublicKey(SAMPLE.publicKey)).toString())
    expect(parseNearPublicKey(nearPublicKey(SAMPLE.publicKey))).toEqual(SAMPLE.publicKey)
    for (const bad of ['secp256k1:abc', 'ed25519:', 'ed25519:0OIl', `ed25519:${near.baseEncode(new Uint8Array(31))}`]) {
      expect(() => parseNearPublicKey(bad)).toThrow(NearDecodeError)
    }
  })

  it('refuses another step, a missing or extra field, or a deposit that isn’t whole yoctoNEAR', () => {
    const refuse = (step: Parameters<typeof transferOfStep>[0]) => expect(() => transferOfStep(step, live)).toThrow(NearDecodeError)
    refuse({ chain: 'evm', action: 'transfer', fields })
    refuse({ chain: 'near', action: 'stake', fields })
    refuse({ chain: 'near', action: 'transfer', fields: { ...fields, memo: 'x' } })
    refuse({ chain: 'near', action: 'transfer', fields: Object.fromEntries(Object.entries(fields).filter(([name]) => name !== 'deposit')) })
    for (const deposit of ['1.5', '-1', '01', '1e24', '']) refuse(nearTransferStep({ ...fields, deposit }))
  })
})
