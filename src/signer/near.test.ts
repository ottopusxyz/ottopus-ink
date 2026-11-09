import { ed25519 } from '@noble/curves/ed25519.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import * as near from 'near-api-js'
// near-api-js's own key derivation, through near-seed-phrase: an independent reference for the NEAR key.
import { derivePath } from 'near-hd-key'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_PATHS } from '../shared/accounts'
import { decodeTransfer, nearPublicKey, nearTransferStep, NearDecodeError, transactionHash } from '../shared/near/transaction'
import { signNearTransfer } from './near'

/** BIP-32 test vector 2's seed, as in accounts.test.ts. A published test seed, not a recovery phrase. */
const SEED_HEX = 'fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542'
const SEED = hexToBytes(SEED_HEX)
const ID = '06b66cee83c72cf7462ac756b159664732607df5bf254e589426b7e4b4f9d60d'
const KEY = nearPublicKey(hexToBytes(ID))

const STEP = nearTransferStep({ signerId: ID, publicKey: KEY, receiverId: 'alice.near', deposit: '1500000000000000000000000' })
const LIVE = { nonce: 223_737_468_000_005n, blockHash: new Uint8Array(32).fill(7) }

describe('signing a NEAR transfer', () => {
  it('gives exactly the signed transaction near-api-js gives for the same key', async () => {
    const { key } = derivePath(ACCOUNT_PATHS.near, SEED_HEX)
    const secret = Uint8Array.from(key)
    const pair = near.KeyPair.fromString(`ed25519:${near.baseEncode(new Uint8Array([...secret, ...ed25519.getPublicKey(secret)]))}`)
    expect(pair.getPublicKey().toString()).toBe(KEY)
    const transaction = near.createTransaction(ID, pair.getPublicKey(), 'alice.near', LIVE.nonce, [near.actions.transfer(1_500_000_000_000_000_000_000_000n)], LIVE.blockHash)
    const { txHash, signedTransaction } = await new near.KeyPairSigner(pair).signTransaction(transaction)

    const ours = signNearTransfer(SEED, STEP, LIVE)
    expect(bytesToHex(ours.signed)).toBe(bytesToHex(signedTransaction.encode()))
    expect(ours.transactionId).toBe(near.baseEncode(txHash))
  })

  it('signs what verifies against the account’s own key', () => {
    const { signed } = signNearTransfer(SEED, STEP, LIVE)
    const transaction = signed.subarray(0, signed.length - 65)
    expect(signed[signed.length - 65]).toBe(0)
    expect(decodeTransfer(transaction)).toMatchObject({ signerId: ID, receiverId: 'alice.near', deposit: 1_500_000_000_000_000_000_000_000n, nonce: LIVE.nonce })
    expect(ed25519.verify(signed.subarray(signed.length - 64), transactionHash(transaction), hexToBytes(ID))).toBe(true)
  })

  it('refuses a step that spends from an account this seed doesn’t hold', () => {
    const other = 'b'.repeat(64)
    expect(() => signNearTransfer(SEED, nearTransferStep({ signerId: other, publicKey: nearPublicKey(hexToBytes(other)), receiverId: 'alice.near', deposit: '1' }), LIVE)).toThrow(NearDecodeError)
    // Its own key, but someone else's account id.
    expect(() => signNearTransfer(SEED, nearTransferStep({ signerId: 'alice.near', publicKey: KEY, receiverId: 'bob.near', deposit: '1' }), LIVE)).toThrow(NearDecodeError)
    // Its own account id, but another key.
    expect(() => signNearTransfer(SEED, nearTransferStep({ signerId: ID, publicKey: nearPublicKey(hexToBytes(other)), receiverId: 'bob.near', deposit: '1' }), LIVE)).toThrow(NearDecodeError)
  })

  it('refuses any step that isn’t a well-formed NEAR transfer', () => {
    expect(() => signNearTransfer(SEED, { ...STEP, action: 'stake' }, LIVE)).toThrow(NearDecodeError)
    expect(() => signNearTransfer(SEED, { ...STEP, fields: { ...STEP.fields, extra: 'x' } }, LIVE)).toThrow(NearDecodeError)
    expect(() => signNearTransfer(SEED, nearTransferStep({ signerId: ID, publicKey: KEY, receiverId: 'Alice.near', deposit: '1' }), LIVE)).toThrow(NearDecodeError)
    expect(() => signNearTransfer(SEED, STEP, { ...LIVE, blockHash: new Uint8Array(31) })).toThrow(NearDecodeError)
  })

  it('leaves the seed for its owner to wipe, unchanged', () => {
    const seed = Uint8Array.from(SEED)
    signNearTransfer(seed, STEP, LIVE)
    expect(seed).toEqual(SEED)
  })
})
