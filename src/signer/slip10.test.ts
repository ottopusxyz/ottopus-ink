import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import { ed25519PublicKey } from './slip10'

/**
 * The ed25519 test vectors from SLIP-10 itself
 * (github.com/satoshilabs/slips/blob/master/slip-0010.md). The spec prints each
 * public key with a leading 00, left off here. The seeds are the spec's public
 * test seeds, not anyone's wallet.
 */
const VECTORS = [
  {
    seed: '000102030405060708090a0b0c0d0e0f',
    keys: [
      ['m', 'a4b2856bfec510abab89753fac1ac0e1112364e7d250545963f135f2a33188ed'],
      ["m/0'", '8c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c'],
      ["m/0'/1'", '1932a5270f335bed617d5b935c80aedb1a35bd9fc1e31acafd5372c30f5c1187'],
      ["m/0'/1'/2'", 'ae98736566d30ed0e9d2f4486a64bc95740d89c7db33f52121f8ea8f76ff0fc1'],
      ["m/0'/1'/2'/2'", '8abae2d66361c879b900d204ad2cc4984fa2aa344dd7ddc46007329ac76c429c'],
      ["m/0'/1'/2'/2'/1000000000'", '3c24da049451555d51a7014a37337aa4e12d41e485abccfa46b47dfb2af54b7a'],
    ],
  },
  {
    seed: 'fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542',
    keys: [
      ['m', '8fe9693f8fa62a4305a140b9764c5ee01e455963744fe18204b4fb948249308a'],
      ["m/0'", '86fab68dcb57aa196c77c5f264f215a112c22a912c10d123b0d03c3c28ef1037'],
      ["m/0'/2147483647'", '5ba3b9ac6e90e83effcd25ac4e58a1365a9e35a3d3ae5eb07b9e4d90bcf7506d'],
      ["m/0'/2147483647'/1'", '2e66aa57069c86cc18249aecf5cb5a9cebbfd6fadeab056254763874a9352b45'],
      ["m/0'/2147483647'/1'/2147483646'", 'e33c0f7d81d843c572275f287498e8d408654fdf0d1e065b84e2e6f157aab09b'],
      ["m/0'/2147483647'/1'/2147483646'/2'", '47150c75db263559a70d5778bf36abbab30fb061ad69f69ece61a72b0cfa4fc0'],
    ],
  },
]

describe('SLIP-10 for ed25519', () => {
  for (const [n, { seed, keys }] of VECTORS.entries()) {
    it.each(keys)(`matches test vector ${n + 1} at %s`, (path, publicKey) => {
      expect(bytesToHex(ed25519PublicKey(hexToBytes(seed), path))).toBe(publicKey)
    })
  }

  it.each([
    ['a level that is not hardened', "m/44'/397'/0"],
    ['a path that does not start at m', "44'/397'"],
    ['an index past the hardened range', "m/2147483648'"],
    ['a level that is not a number', "m/x'"],
  ])('refuses %s', (_label, path) => {
    expect(() => ed25519PublicKey(new Uint8Array(64), path)).toThrow()
  })

  it('leaves the seed as it was', () => {
    const seed = hexToBytes(VECTORS[1]!.seed)
    const copy = seed.slice()
    ed25519PublicKey(seed, "m/44'/397'/0'")
    expect(seed).toEqual(copy)
  })
})
