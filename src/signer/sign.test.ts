import { ed25519 } from '@noble/curves/ed25519.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import { decodeTransfer, nearPublicKey, nearTransferStep, transactionHash } from '../shared/near/transaction'
import { signSteps, SignRefusal } from './sign'

/** BIP-32 test vector 2's seed, as in near.test.ts. A published test seed, not a recovery phrase. */
const SEED = hexToBytes('fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542')
const ID = '06b66cee83c72cf7462ac756b159664732607df5bf254e589426b7e4b4f9d60d'
const KEY = nearPublicKey(hexToBytes(ID))

const step = (receiverId: string, deposit: string) => nearTransferStep({ signerId: ID, publicKey: KEY, receiverId, deposit })
const live = (nonce: string, fill = 7) => ({ nonce, blockHash: fill.toString(16).padStart(2, '0').repeat(32) })

const unsigned = (signed: Uint8Array) => signed.subarray(0, signed.length - 65)

describe('signing the steps of a plan', () => {
  it('signs each step with its own live inputs, in order', () => {
    const signed = signSteps(SEED, [step('alice.near', '1'), step('bob.near', '2')], [live('5'), live('6', 9)])
    expect(signed.map(({ signed }) => decodeTransfer(unsigned(signed)))).toMatchObject([
      { receiverId: 'alice.near', deposit: 1n, nonce: 5n, blockHash: new Uint8Array(32).fill(7) },
      { receiverId: 'bob.near', deposit: 2n, nonce: 6n, blockHash: new Uint8Array(32).fill(9) },
    ])
    for (const { signed: bytes } of signed) {
      expect(ed25519.verify(bytes.subarray(bytes.length - 64), transactionHash(unsigned(bytes)), hexToBytes(ID))).toBe(true)
    }
  })

  it('refuses a plan with no steps, or without live inputs for every step', () => {
    expect(() => signSteps(SEED, [], [])).toThrow(SignRefusal)
    expect(() => signSteps(SEED, [step('alice.near', '1')], [])).toThrow(SignRefusal)
    expect(() => signSteps(SEED, [step('alice.near', '1')], [live('5'), live('6')])).toThrow(SignRefusal)
  })

  it('refuses a step no signing half handles', () => {
    expect(() => signSteps(SEED, [{ chain: 'evm', action: 'transfer', fields: {} }], [live('5')])).toThrow(SignRefusal)
    expect(() => signSteps(SEED, [{ ...step('alice.near', '1'), action: 'stake' }], [live('5')])).toThrow(SignRefusal)
  })

  it('refuses the whole plan when any one step is refused', () => {
    const other = 'b'.repeat(64)
    const theirs = nearTransferStep({ signerId: other, publicKey: nearPublicKey(hexToBytes(other)), receiverId: 'alice.near', deposit: '1' })
    expect(() => signSteps(SEED, [step('alice.near', '1'), theirs], [live('5'), live('6')])).toThrow(SignRefusal)
  })

  it('takes a nonce only as a whole u64 above zero', () => {
    expect(signSteps(SEED, [step('alice.near', '1')], [live((2n ** 64n - 1n).toString())])).toHaveLength(1)
    for (const nonce of ['0', '01', '-1', '1.5', ' 5', (2n ** 64n).toString(), '1'.repeat(21), '']) {
      expect(() => signSteps(SEED, [step('alice.near', '1')], [live(nonce)]), nonce).toThrow(SignRefusal)
    }
    expect(() => signSteps(SEED, [step('alice.near', '1')], [{ nonce: 5 as unknown as string, blockHash: live('5').blockHash }])).toThrow(SignRefusal)
  })

  it('takes a block hash only as 32 bytes of lowercase hex', () => {
    const hash = live('5', 0xab).blockHash
    for (const blockHash of [hash.slice(2), hash + '00', hash.toUpperCase(), 'z' + hash.slice(1)]) {
      expect(() => signSteps(SEED, [step('alice.near', '1')], [{ nonce: '5', blockHash }]), blockHash).toThrow(SignRefusal)
    }
  })
})
