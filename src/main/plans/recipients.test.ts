import { describe, expect, it } from 'vitest'
import { ACCOUNT_CHAINS, ACCOUNT_PATHS, type Account } from '../../shared/accounts'
import { allowedRecipient } from './recipients'

/** Public addresses from the BIP-32 test seed, as derived in src/signer/accounts.test.ts. */
const OWN: Account[] = [
  { chain: 'near', address: '06b66cee83c72cf7462ac756b159664732607df5bf254e589426b7e4b4f9d60d' },
  { chain: 'evm', address: '0xBbEC2620Cb01adae3f96e1fa39f997f06BFb7Ca0' },
  { chain: 'solana', address: 'QVQwskmGkDfxQfRkbFJeY2YFm7go3ciiLvuANp1AsCi' },
  { chain: 'bitcoin', address: 'bc1qg6ucjz7kgdedam7v5yarecy54uqw82yym06z3q' },
  { chain: 'tron', address: 'TYr2rNxJLVnU3wAWxdFYnRMRtaQ7fALytK' },
  { chain: 'sui', address: '0x2f76254051cf80c69916df247e2b2313b37415341c2a4a1b3779d38296ca34e7' },
  { chain: 'aptos', address: '0x99b12354939ab8cb62d239c234580755407e015c81acf025b598dc75c9e2f3f5' },
].map((account) => ({ ...account, chain: account.chain as Account['chain'], path: ACCOUNT_PATHS[account.chain as Account['chain']] }))

const own = (chain: Account['chain']) => OWN.find((account) => account.chain === chain)!.address
const STRANGER_EVM = '0x1111111111111111111111111111111111111111'

describe('allowedRecipient', () => {
  it('allows each of the person’s own addresses on its own chain', () => {
    expect(OWN.map((account) => account.chain)).toEqual(ACCOUNT_CHAINS)
    for (const { chain, address } of OWN) expect(allowedRecipient(address, chain, OWN, [])).toEqual({ address, why: 'own' })
  })

  it('allows the own EVM address on any EVM chain by name, whatever the case of either', () => {
    const lower = own('evm').toLowerCase()
    for (const chain of ['base', 'Ethereum', 'arbitrum', 'evm']) expect(allowedRecipient(lower, chain, OWN, [])).toEqual({ address: lower, why: 'own' })
  })

  it('refuses an own address on another chain, untyped, even when the formats look alike', () => {
    // A Sui and an Aptos address are both 0x and 64 hex: owning one says nothing about the other chain.
    expect(allowedRecipient(own('sui'), 'aptos', OWN, [])).toBeNull()
    expect(allowedRecipient(own('aptos'), 'sui', OWN, [])).toBeNull()
    expect(allowedRecipient(own('evm'), 'tron', OWN, [])).toBeNull()
    expect(allowedRecipient(own('near'), 'solana', OWN, [])).toBeNull()
  })

  it('counts nothing as the person’s own when the chain is missing or unknown', () => {
    expect(allowedRecipient(own('near'), null, OWN, [])).toBeNull()
    expect(allowedRecipient(own('evm'), 'zksync-lite', OWN, [])).toBeNull()
    // Typing it still allows it.
    expect(allowedRecipient(own('near'), null, OWN, [`to ${own('near')}`])).toEqual({ address: own('near'), why: 'typed' })
  })

  it('allows an address the person typed, wherever it sits in their sentence', () => {
    const typed = [
      'send 1 NEAR to alice.near.',
      'and 5 USDC to (0x1111111111111111111111111111111111111111), thanks!',
      'pay "bob.near"',
      'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      'tron TJRabPrwbZy45sbavfcjinPJC18kjpRTv8?',
    ]
    for (const address of ['alice.near', STRANGER_EVM, 'bob.near', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8']) {
      expect(allowedRecipient(address, 'near', OWN, typed)).toEqual({ address, why: 'typed' })
    }
  })

  it('refuses an address only the agent came up with', () => {
    expect(allowedRecipient('mallory.near', 'near', OWN, ['send 1 NEAR to alice.near'])).toBeNull()
    expect(allowedRecipient(STRANGER_EVM, 'base', OWN, [])).toBeNull()
  })

  it('refuses part of a typed word, or a longer one', () => {
    const typed = ['send to malice.near and to alice.nearby']
    expect(allowedRecipient('alice.near', 'near', OWN, typed)).toBeNull()
    expect(allowedRecipient('alice.nea', 'near', OWN, ['send to alice.near'])).toBeNull()
    expect(allowedRecipient('0x11111111111111111111111111111111111111', 'base', OWN, [`to ${STRANGER_EVM}`])).toBeNull()
  })

  it('matches a typed EVM address whatever its case, and every other chain’s exactly', () => {
    expect(allowedRecipient('0xAbCdEf0000000000000000000000000000000001', 'base', OWN, ['to 0xabcdef0000000000000000000000000000000001'])?.why).toBe('typed')
    // Solana and Tron addresses are case-sensitive, and NEAR's are lower case.
    expect(allowedRecipient('TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', 'tron', OWN, ['to tjrabprwbzy45sbavfcjinpjc18kjprtv8'])).toBeNull()
    expect(allowedRecipient('alice.near', 'near', OWN, ['to Alice.near'])).toBeNull()
  })

  it('refuses an empty address', () => {
    expect(allowedRecipient('', 'near', OWN, [''])).toBeNull()
  })
})
