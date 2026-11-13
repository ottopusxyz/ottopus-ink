/**
 * The EVM chains Ink sends on, all from the wallet's one EVM address. `chainId` goes into
 * every transaction, so a signature for one chain can't be replayed on another, and the
 * sender checks each RPC reports it before using that RPC. `oneClick` is 1Click's name for
 * the chain where NEAR Intents takes deposits from it, and `zerion` Zerion's.
 */
export interface EvmChain {
  /** Ink's name for it: `base`. */
  id: string
  name: string
  chainId: number
  /** The chain's own coin, which pays its fees. */
  symbol: string
  oneClick: string | null
  zerion: string | null
  /** Public RPCs, tried in order. */
  rpcs: readonly string[]
  /** Where it shows a transaction. */
  explorer: { name: string; tx: string }
}

const chain = (id: string, name: string, chainId: number, symbol: string, oneClick: string | null, zerion: string | null, rpcs: string[], explorer: [string, string]): EvmChain => ({
  id,
  name,
  chainId,
  symbol,
  oneClick,
  zerion,
  rpcs,
  explorer: { name: explorer[0], tx: explorer[1] },
})

export const EVM_CHAINS: readonly EvmChain[] = [
  chain('ethereum', 'Ethereum', 1, 'ETH', 'eth', 'ethereum', ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'], ['Etherscan', 'https://etherscan.io/tx/']),
  chain('base', 'Base', 8453, 'ETH', 'base', 'base', ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'], ['BaseScan', 'https://basescan.org/tx/']),
  chain('arbitrum', 'Arbitrum', 42161, 'ETH', 'arb', 'arbitrum', ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'], ['Arbiscan', 'https://arbiscan.io/tx/']),
  chain('optimism', 'Optimism', 10, 'ETH', 'op', 'optimism', ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'], ['Optimism Etherscan', 'https://optimistic.etherscan.io/tx/']),
  chain('polygon', 'Polygon', 137, 'POL', 'pol', 'polygon', ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'], ['PolygonScan', 'https://polygonscan.com/tx/']),
  chain('bsc', 'BNB Chain', 56, 'BNB', 'bsc', 'binance-smart-chain', ['https://bsc-dataseed.bnbchain.org', 'https://bsc-rpc.publicnode.com'], ['BscScan', 'https://bscscan.com/tx/']),
  chain('avalanche', 'Avalanche', 43114, 'AVAX', 'avax', 'avalanche', ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com'], ['Snowtrace', 'https://snowtrace.io/tx/']),
  chain('gnosis', 'Gnosis', 100, 'xDAI', 'gnosis', 'xdai', ['https://rpc.gnosischain.com', 'https://gnosis-rpc.publicnode.com'], ['GnosisScan', 'https://gnosisscan.io/tx/']),
  chain('berachain', 'Berachain', 80094, 'BERA', 'bera', 'berachain', ['https://rpc.berachain.com', 'https://berachain-rpc.publicnode.com'], ['Berascan', 'https://berascan.com/tx/']),
  chain('scroll', 'Scroll', 534352, 'ETH', 'scroll', 'scroll', ['https://rpc.scroll.io', 'https://scroll-rpc.publicnode.com'], ['Scrollscan', 'https://scrollscan.com/tx/']),
  chain('linea', 'Linea', 59144, 'ETH', null, 'linea', ['https://rpc.linea.build', 'https://linea-rpc.publicnode.com'], ['LineaScan', 'https://lineascan.build/tx/']),
  chain('unichain', 'Unichain', 130, 'ETH', null, 'unichain', ['https://mainnet.unichain.org', 'https://unichain-rpc.publicnode.com'], ['Uniscan', 'https://uniscan.xyz/tx/']),
  chain('sonic', 'Sonic', 146, 'S', null, 'sonic', ['https://rpc.soniclabs.com', 'https://sonic-rpc.publicnode.com'], ['SonicScan', 'https://sonicscan.org/tx/']),
  chain('mantle', 'Mantle', 5000, 'MNT', null, 'mantle', ['https://rpc.mantle.xyz', 'https://mantle-rpc.publicnode.com'], ['Mantlescan', 'https://mantlescan.xyz/tx/']),
  chain('xlayer', 'X Layer', 196, 'OKB', 'xlayer', null, ['https://rpc.xlayer.tech', 'https://xlayer.drpc.org'], ['OKLink', 'https://www.oklink.com/xlayer/tx/']),
  chain('monad', 'Monad', 143, 'MON', 'monad', null, ['https://rpc.monad.xyz', 'https://monad-mainnet.drpc.org'], ['MonadVision', 'https://monadvision.com/tx/']),
  chain('plasma', 'Plasma', 9745, 'XPL', 'plasma', null, ['https://rpc.plasma.to'], ['Plasmascan', 'https://plasmascan.to/tx/']),
  chain('abstract', 'Abstract', 2741, 'ETH', 'abs', null, ['https://api.mainnet.abs.xyz', 'https://abstract.drpc.org'], ['Abscan', 'https://abscan.org/tx/']),
]

/** Names people and agents use for EVM chains, as Ink's own. */
const ALIASES: Record<string, string> = { eth: 'ethereum', mainnet: 'ethereum', arb: 'arbitrum', op: 'optimism', pol: 'polygon', matic: 'polygon', bnb: 'bsc', 'bnb-chain': 'bsc', bnbchain: 'bsc', binance: 'bsc', avax: 'avalanche', xdai: 'gnosis', bera: 'berachain', 'x-layer': 'xlayer', abs: 'abstract' }

/** An EVM chain by any name for it, or null. */
export function evmChainOf(name: string | null | undefined): EvmChain | null {
  if (!name) return null
  const word = name.trim().toLowerCase().replace(/\s+/g, '-')
  const id = ALIASES[word] ?? word
  return EVM_CHAINS.find((each) => each.id === id) ?? null
}

/** An EVM chain by its chain id, or null. */
export const evmChainById = (chainId: number): EvmChain | null => EVM_CHAINS.find((each) => each.chainId === chainId) ?? null

/** An EVM chain by 1Click's name for it (`arb`, `bsc`), or null. */
export const evmChainOfOneClick = (code: string): EvmChain | null => EVM_CHAINS.find((each) => each.oneClick === code) ?? null
