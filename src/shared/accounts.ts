/** The chains Ink holds a local key for. Other chains Intents supports get a deposit address instead, from the bridge. */
export type AccountChain = 'near' | 'evm' | 'solana' | 'bitcoin' | 'tron' | 'sui' | 'aptos'

/** One address from the seed. Public: it holds no key. */
export interface Account {
  chain: AccountChain
  /** Where the key sits under the seed, so another wallet given the same phrase finds the same address. */
  path: string
  address: string
}

/**
 * The first account on each chain, at the path most wallets use for it, so a
 * phrase restored elsewhere shows the same addresses.
 */
export const ACCOUNT_PATHS: Record<AccountChain, string> = {
  /** Its implicit account, which is also the NEAR Intents account. */
  near: "m/44'/397'/0'",
  /** One EOA, the same 0x address on every EVM chain. */
  evm: "m/44'/60'/0'/0/0",
  solana: "m/44'/501'/0'/0'",
  /** Native SegWit, the first receive address. */
  bitcoin: "m/84'/0'/0'/0/0",
  tron: "m/44'/195'/0'/0/0",
  sui: "m/44'/784'/0'/0'/0'",
  aptos: "m/44'/637'/0'/0'/0'",
}

export const ACCOUNT_CHAINS = Object.keys(ACCOUNT_PATHS) as AccountChain[]
