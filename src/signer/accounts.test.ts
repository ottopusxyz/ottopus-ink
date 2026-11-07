import { randomBytes } from 'node:crypto'
import { hexToBytes } from '@noble/hashes/utils.js'
import { base58 } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_CHAINS, ACCOUNT_PATHS, type AccountChain } from '../shared/accounts'
import { deriveAccounts } from './accounts'

/**
 * The 64-byte seed from BIP-32 test vector 2, which SLIP-10 also uses. It's a
 * published test seed, not a recovery phrase.
 */
const SPEC_SEED = hexToBytes(
  'fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542',
)

/**
 * What each chain's reference library gives for that seed at Ink's paths. They
 * were worked out on 7 Nov 2026 with ethers 6.17.0 (EVM), bitcoinjs-lib 7.0.5
 * with bip32 5.0.1 (Bitcoin), tronweb 6.5.1 (Tron), @solana/web3.js 1.98.4 with
 * ed25519-hd-key 2.0.0 (Solana, as the Solana cookbook does it), near-hd-key
 * 1.2.1 (NEAR, what near-seed-phrase uses), @mysten/sui 2.39.1 (Sui) and
 * @aptos-labs/ts-sdk 7.5.0 (Aptos). The same libraries agreed with Ink on random
 * phrases of both lengths, from words to address.
 */
const REFERENCE: Record<AccountChain, string> = {
  near: '06b66cee83c72cf7462ac756b159664732607df5bf254e589426b7e4b4f9d60d',
  evm: '0xBbEC2620Cb01adae3f96e1fa39f997f06BFb7Ca0',
  solana: 'QVQwskmGkDfxQfRkbFJeY2YFm7go3ciiLvuANp1AsCi',
  bitcoin: 'bc1qg6ucjz7kgdedam7v5yarecy54uqw82yym06z3q',
  tron: 'TYr2rNxJLVnU3wAWxdFYnRMRtaQ7fALytK',
  sui: '0x2f76254051cf80c69916df247e2b2313b37415341c2a4a1b3779d38296ca34e7',
  aptos: '0x99b12354939ab8cb62d239c234580755407e015c81acf025b598dc75c9e2f3f5',
}

const SHAPE: Record<AccountChain, RegExp> = {
  near: /^[0-9a-f]{64}$/,
  evm: /^0x[0-9a-fA-F]{40}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  bitcoin: /^bc1q[02-9ac-hj-np-z]{38}$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  sui: /^0x[0-9a-f]{64}$/,
  aptos: /^0x[0-9a-f]{64}$/,
}

const randomSeed = () => new Uint8Array(randomBytes(64))

describe('deriving accounts', () => {
  it.each(ACCOUNT_CHAINS)('gives the same %s address as its reference wallet library', (chain) => {
    expect(deriveAccounts(SPEC_SEED).find((account) => account.chain === chain)?.address).toBe(REFERENCE[chain])
  })

  it('gives one account per chain, in order, each at its standard path', () => {
    expect(deriveAccounts(randomSeed()).map(({ chain, path }) => ({ chain, path }))).toEqual(ACCOUNT_CHAINS.map((chain) => ({ chain, path: ACCOUNT_PATHS[chain] })))
  })

  it('pins the standard paths', () => {
    expect(ACCOUNT_PATHS).toEqual({
      near: "m/44'/397'/0'",
      evm: "m/44'/60'/0'/0/0",
      solana: "m/44'/501'/0'/0'",
      bitcoin: "m/84'/0'/0'/0/0",
      tron: "m/44'/195'/0'/0/0",
      sui: "m/44'/784'/0'/0'/0'",
      aptos: "m/44'/637'/0'/0'/0'",
    })
  })

  it('gives addresses in each chain’s format, the same every time for a seed', () => {
    for (let i = 0; i < 20; i++) {
      const seed = randomSeed()
      const accounts = deriveAccounts(seed)
      for (const { chain, address } of accounts) expect(address, chain).toMatch(SHAPE[chain])
      expect(base58.decode(accounts.find((account) => account.chain === 'solana')!.address)).toHaveLength(32)
      expect(deriveAccounts(seed)).toEqual(accounts)
    }
  })

  it('gives different addresses for different seeds', () => {
    const [one, two] = [deriveAccounts(randomSeed()), deriveAccounts(randomSeed())]
    for (const [i, account] of one.entries()) expect(account.address).not.toBe(two[i]!.address)
  })

  it('leaves the seed for the caller to wipe, unchanged', () => {
    const seed = randomSeed()
    const copy = seed.slice()
    deriveAccounts(seed)
    expect(seed).toEqual(copy)
  })

  it('refuses anything but a 64-byte seed', () => {
    expect(() => deriveAccounts(new Uint8Array(32))).toThrow()
  })
})
