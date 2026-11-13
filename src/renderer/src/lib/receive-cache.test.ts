import { describe, expect, it } from 'vitest'
import type { ReceiveChain, ReceiveToken } from '../../../shared/ipc'
import { CHAINS_FRESH_MS, SEARCHES_KEPT, SEARCH_FRESH_MS, receiveCache } from './receive-cache'

const BASE: ReceiveChain = { id: 'base', name: 'Base', mark: 'base', own: 'evm', intents: true, tokens: [{ symbol: 'USDC', name: null, min: '1', intents: true, icon: null }] }
const USDC: ReceiveToken = { symbol: 'USDC', name: null, min: '1', intents: true, icon: null }

function setup(lists: ReceiveChain[][] = [[BASE]]) {
  let clock = 0
  const asked = { chains: 0, searches: [] as string[] }
  const cache = receiveCache({
    listChains: async () => lists[Math.min(asked.chains++, lists.length - 1)] ?? [],
    searchTokens: async (chain, query) => (asked.searches.push(`${chain} ${query}`), [USDC]),
    now: () => clock,
  })
  return { cache, asked, later: (ms: number) => (clock += ms) }
}

describe('the Receive screen’s cache', () => {
  it('lists the chains once while fresh, and asks once for callers that come together', async () => {
    const { cache, asked, later } = setup()
    expect(cache.chains()).toBeNull()
    await Promise.all([cache.loadChains(), cache.loadChains()])
    expect(asked.chains).toBe(1)
    expect(cache.chains()).toEqual([BASE])
    later(CHAINS_FRESH_MS)
    await cache.loadChains()
    expect(asked.chains).toBe(1)
    later(1)
    await cache.loadChains()
    expect(asked.chains).toBe(2)
  })

  it('doesn’t keep an empty list, so the next visit asks again', async () => {
    const { cache, asked } = setup([[], [BASE]])
    expect(await cache.loadChains()).toEqual([])
    expect(cache.chains()).toBeNull()
    expect(await cache.loadChains()).toEqual([BASE])
    expect(asked.chains).toBe(2)
  })

  it('answers a search again from the cache, whatever its case or spaces, until it goes stale', async () => {
    const { cache, asked, later } = setup()
    expect(cache.search('base', 'usdc')).toBeNull()
    await cache.loadSearch('base', 'usdc')
    expect(cache.search('base', ' USDC ')).toEqual([USDC])
    await cache.loadSearch('base', 'Usdc')
    expect(asked.searches).toEqual(['base usdc'])
    // Another chain is another search.
    await cache.loadSearch('ethereum', 'usdc')
    expect(asked.searches).toHaveLength(2)
    later(SEARCH_FRESH_MS + 1)
    expect(cache.search('base', 'usdc')).toBeNull()
  })

  it('keeps only the most recent searches', async () => {
    const { cache } = setup()
    for (let i = 0; i <= SEARCHES_KEPT; i++) await cache.loadSearch('base', `q${i}`)
    expect(cache.search('base', 'q0')).toBeNull()
    expect(cache.search('base', `q${SEARCHES_KEPT}`)).toEqual([USDC])
  })
})
