import { describe, expect, it } from 'vitest'
import { assetKind, CHAIN_ASSETS, receiveAsset, receiveNetwork } from './receive'

describe('what a receive shows', () => {
  it('keeps the picked asset only on a chain that has it', () => {
    expect(receiveAsset('evm', 'USDC')).toBe('USDC')
    expect(receiveAsset('bitcoin', 'USDC')).toBe('BTC')
    expect(receiveAsset('near', null)).toBe('NEAR')
  })

  it('names the EVM network picked, and every other chain by its own name', () => {
    expect(receiveNetwork('evm', 'Ethereum and EVM chains', 'base')).toBe('Base')
    expect(receiveNetwork('evm', 'Ethereum and EVM chains', 'near')).toBe('Ethereum')
    expect(receiveNetwork('solana', 'Solana', 'base')).toBe('Solana')
  })

  it('leads every chain with its own coin', () => {
    expect(Object.values(CHAIN_ASSETS).map((assets) => assets[0])).toEqual(['NEAR', 'ETH', 'SOL', 'BTC', 'TRX', 'SUI', 'APT'])
  })
})

describe('asset kinds', () => {
  it('calls each chain’s own coin native and the dollars stablecoins', () => {
    expect(assetKind('near', 'NEAR')).toBe('native')
    expect(assetKind('evm', 'ETH')).toBe('native')
    expect(assetKind('tron', 'USDT')).toBe('stablecoin')
    expect(assetKind('solana', 'USDC')).toBe('stablecoin')
  })
})
