import type { AccountChain } from '../../../shared/accounts'
import type { ChainId, TokenSymbol } from './logos'

/** A short line under each chain in the picker. CHAIN_INFO's note is the longer warning under the address. */
export const CHAIN_SUB: Record<AccountChain, string> = {
  near: 'and NEAR Intents',
  evm: '6 networks',
  solana: 'SOL and SPL tokens',
  bitcoin: 'Native SegWit',
  tron: 'TRX and USDT',
  sui: 'SUI and tokens',
  aptos: 'APT and tokens',
}

/** What's usually received on each chain, native coin first. */
export const CHAIN_ASSETS: Record<AccountChain, readonly TokenSymbol[]> = {
  near: ['NEAR', 'USDC', 'USDT'],
  evm: ['ETH', 'USDC', 'USDT'],
  solana: ['SOL', 'USDC'],
  bitcoin: ['BTC'],
  tron: ['TRX', 'USDT'],
  sui: ['SUI', 'USDC'],
  aptos: ['APT', 'USDC'],
}

/** The networks one EVM address works on. Picking one only labels the QR, so the sender is told the right network. */
export const EVM_NETWORKS: readonly { id: ChainId; name: string }[] = [
  { id: 'ethereum', name: 'Ethereum' },
  { id: 'base', name: 'Base' },
  { id: 'arbitrum', name: 'Arbitrum' },
  { id: 'optimism', name: 'Optimism' },
  { id: 'polygon', name: 'Polygon' },
  { id: 'bsc', name: 'BNB Chain' },
]

/** The network a receive is on, by name: the chosen EVM network, or the chain itself. */
export function receiveNetwork(chain: AccountChain, chainName: string, evmNetwork: ChainId): string {
  if (chain !== 'evm') return chainName
  return EVM_NETWORKS.find((network) => network.id === evmNetwork)?.name ?? 'Ethereum'
}

/** The asset to show for a chain: the one picked if the chain has it, else the chain's own coin. */
export function receiveAsset(chain: AccountChain, picked: string | null): TokenSymbol {
  const assets = CHAIN_ASSETS[chain]
  return assets.find((asset) => asset === picked) ?? assets[0] ?? 'NEAR'
}
