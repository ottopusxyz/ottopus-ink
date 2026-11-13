/** Where each chain Ink receives on shows a transaction, by Ink's name for the chain. */
const TX_PAGES: Record<string, { name: string; url: (tx: string) => string }> = {
  near: { name: 'NearBlocks', url: (tx) => `https://nearblocks.io/txns/${tx}` },
  ethereum: { name: 'Etherscan', url: (tx) => `https://etherscan.io/tx/${tx}` },
  base: { name: 'BaseScan', url: (tx) => `https://basescan.org/tx/${tx}` },
  arbitrum: { name: 'Arbiscan', url: (tx) => `https://arbiscan.io/tx/${tx}` },
  optimism: { name: 'Optimism Etherscan', url: (tx) => `https://optimistic.etherscan.io/tx/${tx}` },
  polygon: { name: 'PolygonScan', url: (tx) => `https://polygonscan.com/tx/${tx}` },
  bsc: { name: 'BscScan', url: (tx) => `https://bscscan.com/tx/${tx}` },
  avalanche: { name: 'Snowtrace', url: (tx) => `https://snowtrace.io/tx/${tx}` },
  gnosis: { name: 'GnosisScan', url: (tx) => `https://gnosisscan.io/tx/${tx}` },
  berachain: { name: 'Berascan', url: (tx) => `https://berascan.com/tx/${tx}` },
  scroll: { name: 'Scrollscan', url: (tx) => `https://scrollscan.com/tx/${tx}` },
  solana: { name: 'Solscan', url: (tx) => `https://solscan.io/tx/${tx}` },
  bitcoin: { name: 'mempool.space', url: (tx) => `https://mempool.space/tx/${tx}` },
  tron: { name: 'Tronscan', url: (tx) => `https://tronscan.org/#/transaction/${tx}` },
  sui: { name: 'Suiscan', url: (tx) => `https://suiscan.xyz/mainnet/tx/${tx}` },
  aptos: { name: 'Aptos Explorer', url: (tx) => `https://explorer.aptoslabs.com/txn/${tx}?network=mainnet` },
  ton: { name: 'Tonviewer', url: (tx) => `https://tonviewer.com/transaction/${tx}` },
  xrp: { name: 'XRPSCAN', url: (tx) => `https://xrpscan.com/tx/${tx}` },
  stellar: { name: 'StellarExpert', url: (tx) => `https://stellar.expert/explorer/public/tx/${tx}` },
  dogecoin: { name: 'Blockchair', url: (tx) => `https://blockchair.com/dogecoin/transaction/${tx}` },
  litecoin: { name: 'Blockchair', url: (tx) => `https://blockchair.com/litecoin/transaction/${tx}` },
  'bitcoin-cash': { name: 'Blockchair', url: (tx) => `https://blockchair.com/bitcoin-cash/transaction/${tx}` },
  zcash: { name: 'Blockchair', url: (tx) => `https://blockchair.com/zcash/transaction/${tx}` },
  cardano: { name: 'Cardanoscan', url: (tx) => `https://cardanoscan.io/transaction/${tx}` },
  starknet: { name: 'Voyager', url: (tx) => `https://voyager.online/tx/${tx}` },
}

/**
 * A transaction's page on its chain's explorer, with the explorer's name, or null for a
 * chain Ink has none for or a hash that isn't one. The hash goes into the path as is, so
 * only plain hash characters are taken.
 */
export function txPage(chain: string, tx: string): { name: string; url: string } | null {
  const page = TX_PAGES[chain]
  if (!page || !/^[A-Za-z0-9_-]{8,128}$/.test(tx)) return null
  return { name: page.name, url: page.url(tx) }
}

/** 1Click's short names for chains, as Ink names them in the table above. The Intents balance lives on NEAR. */
const ONE_CLICK_CHAINS: Record<string, string> = {
  near: 'near',
  intents: 'near',
  eth: 'ethereum',
  base: 'base',
  arb: 'arbitrum',
  op: 'optimism',
  pol: 'polygon',
  bsc: 'bsc',
  avax: 'avalanche',
  gnosis: 'gnosis',
  bera: 'berachain',
  scroll: 'scroll',
  sol: 'solana',
  btc: 'bitcoin',
  tron: 'tron',
  sui: 'sui',
  aptos: 'aptos',
  ton: 'ton',
  xrp: 'xrp',
  stellar: 'stellar',
  doge: 'dogecoin',
  ltc: 'litecoin',
  bch: 'bitcoin-cash',
  zec: 'zcash',
  cardano: 'cardano',
  starknet: 'starknet',
}

/** Ink's name for a chain as 1Click names it (`sol` is `solana`), or null for one Ink doesn't name. */
export const inkChainOf = (code: string): string | null => ONE_CLICK_CHAINS[code] ?? null

/** A transaction's page on the explorer of a chain as 1Click names it (`bsc`, `sol`), or null. */
export const oneClickTxPage = (chain: string, tx: string): { name: string; url: string } | null => {
  const ink = ONE_CLICK_CHAINS[chain]
  return ink ? txPage(ink, tx) : null
}
