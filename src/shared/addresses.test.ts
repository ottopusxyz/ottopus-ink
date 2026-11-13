import { describe, expect, it } from 'vitest'
import { isAddressOn, isEvmAddress, isSolanaAddress } from './addresses'

describe('addresses on each chain', () => {
  it('takes an EVM address with a right checksum, or in one case', () => {
    // EIP-55's own test vectors.
    for (const address of ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb'])
      expect(isEvmAddress(address)).toBe(true)
    expect(isEvmAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(true)
    expect(isEvmAddress('0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED')).toBe(true)
  })

  it('refuses an EVM address with a wrong checksum, the wrong length or no 0x', () => {
    expect(isEvmAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toBe(false)
    expect(isEvmAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeA')).toBe(false)
    expect(isEvmAddress('5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(false)
    expect(isEvmAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeg')).toBe(false)
  })

  it('takes a Solana address only when it is 32 bytes of base58', () => {
    expect(isSolanaAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).toBe(true)
    expect(isSolanaAddress('So11111111111111111111111111111111111111112')).toBe(true)
    expect(isSolanaAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWW0')).toBe(false)
    expect(isSolanaAddress('abc')).toBe(false)
    expect(isSolanaAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(false)
  })

  it('checks each chain by its own rule, and refuses the chains it doesn’t check yet', () => {
    expect(isAddressOn('evm', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(true)
    expect(isAddressOn('solana', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(false)
    expect(isAddressOn('near', 'alice.near')).toBe(true)
    expect(isAddressOn('near', 'Alice.near')).toBe(false)
    expect(isAddressOn('bitcoin', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(false)
    expect(isAddressOn('tron', 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE')).toBe(false)
  })
})
