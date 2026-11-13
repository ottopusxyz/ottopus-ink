import type { ReceiveChain, ReceiveToken } from '../../../shared/ipc'

/**
 * What the Receive screen has already asked main for, kept for a while so that coming
 * back to it, or typing a search again, doesn't wait on the network. Only chain lists
 * and token searches: neither holds an address or an amount.
 */
export interface ReceiveCache {
  /** The chains last listed, however old, for showing at once. */
  chains(): ReceiveChain[] | null
  /** The chains, from the cache while fresh, else asked again. One ask at a time. */
  loadChains(): Promise<ReceiveChain[]>
  /** A search already answered and still fresh, or null. */
  search(chain: string, query: string): ReceiveToken[] | null
  /** A chain's tokens matching a search, from the cache while fresh. */
  loadSearch(chain: string, query: string): Promise<ReceiveToken[]>
}

/** Chains change rarely; main keeps the bridge's list for ten minutes too. */
export const CHAINS_FRESH_MS = 10 * 60_000
/** Searches, as long as the service keeps Zerion's answer. */
export const SEARCH_FRESH_MS = 5 * 60_000
/** Searches kept, the oldest dropped first. */
export const SEARCHES_KEPT = 60

export function receiveCache({
  listChains,
  searchTokens,
  now = Date.now,
}: {
  listChains: () => Promise<ReceiveChain[]>
  searchTokens: (chain: string, query: string) => Promise<ReceiveToken[]>
  now?: () => number
}): ReceiveCache {
  let chains: { list: ReceiveChain[]; at: number } | null = null
  let asking: Promise<ReceiveChain[]> | null = null
  const searches = new Map<string, { tokens: ReceiveToken[]; at: number }>()
  const keyOf = (chain: string, query: string) => `${chain}\n${query.trim().toLowerCase()}`

  const search = (chain: string, query: string) => {
    const key = keyOf(chain, query)
    const kept = searches.get(key)
    if (!kept || now() - kept.at > SEARCH_FRESH_MS) return null
    // Used again: moves to the back, so it's dropped last.
    searches.delete(key)
    searches.set(key, kept)
    return kept.tokens
  }

  return {
    chains: () => chains?.list ?? null,
    loadChains() {
      if (chains && now() - chains.at <= CHAINS_FRESH_MS) return Promise.resolve(chains.list)
      asking ??= listChains()
        .then((list) => {
          // An empty list is the bridge and the wallet both out of reach: not worth keeping.
          if (list.length > 0) chains = { list, at: now() }
          return list
        })
        .finally(() => {
          asking = null
        })
      return asking
    },
    search,
    async loadSearch(chain, query) {
      const kept = search(chain, query)
      if (kept) return kept
      const tokens = await searchTokens(chain, query.trim())
      searches.set(keyOf(chain, query), { tokens, at: now() })
      while (searches.size > SEARCHES_KEPT) searches.delete(searches.keys().next().value as string)
      return tokens
    },
  }
}

let shared: ReceiveCache | null = null

/** The app's one cache, over `window.ink`. */
export function receiveCacheOfApp(): ReceiveCache {
  shared ??= receiveCache({ listChains: () => window.ink.receiveChains(), searchTokens: (chain, query) => window.ink.searchReceiveTokens(chain, query) })
  return shared
}
