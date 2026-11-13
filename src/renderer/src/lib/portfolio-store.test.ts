import { describe, expect, it } from 'vitest'
import type { PortfolioResult } from '../../../shared/portfolio'
import { createPortfolioStore, REVALIDATE_MS, type PortfolioSource } from './portfolio-store'

const result = (totalUsd: number, readAt = 0): PortfolioResult => ({
  ok: true,
  near: { accountId: 'alice.near', onChain: true, available: '1', staked: '0', storage: '0', pools: [], stakingComplete: true },
  nearPrice: null,
  tokens: [],
  zerion: 'off',
  zerionVia: null,
  unread: [],
  unpriced: 0,
  totalUsd,
  readAt,
  gaps: [],
})

/** A bridge whose answers the test hands out when it likes. */
function fakeSource(saved: PortfolioResult | null = null) {
  const live: { fresh: boolean; answer: (result: PortfolioResult) => void; fail: () => void }[] = []
  let savedAnswer: ((value: PortfolioResult | null) => void) | null = null
  const source: PortfolioSource = {
    portfolio: ({ fresh = false } = {}) =>
      new Promise((resolve, reject) => live.push({ fresh, answer: resolve, fail: () => reject(new Error('down')) })),
    savedPortfolio: () => new Promise((resolve) => (savedAnswer = resolve)),
  }
  return { source, live, giveSaved: () => savedAnswer?.(saved) }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the portfolio store', () => {
  it('shows the saved copy at once, then the live read in its place', async () => {
    const { source, live, giveSaved } = fakeSource(result(10, 1))
    const store = createPortfolioStore(source)
    store.revalidate()
    expect(store.get()).toMatchObject({ result: null, reading: true })
    giveSaved()
    await settled()
    expect(store.get()).toMatchObject({ result: { totalUsd: 10 }, reading: true, saved: true })
    live[0]!.answer(result(20, 2))
    await settled()
    expect(store.get()).toMatchObject({ result: { totalUsd: 20 }, reading: false, saved: false, failed: false })
  })

  it('never lets a saved copy replace a live read that came first', async () => {
    const { source, live, giveSaved } = fakeSource(result(10))
    const store = createPortfolioStore(source)
    store.revalidate()
    live[0]!.answer(result(20))
    await settled()
    giveSaved()
    await settled()
    expect(store.get()).toMatchObject({ result: { totalUsd: 20 }, saved: false })
  })

  it('keeps the figures shown when a read fails, and says so', async () => {
    let time = 0
    const { source, live } = fakeSource()
    const store = createPortfolioStore(source, { now: () => time })
    store.revalidate()
    live[0]!.answer(result(20))
    await settled()
    store.refresh()
    live[1]!.answer({ ok: false, reason: 'unavailable' })
    await settled()
    expect(store.get()).toMatchObject({ result: { totalUsd: 20 }, failed: true })
    store.refresh()
    live[2]!.fail()
    await settled()
    expect(store.get()).toMatchObject({ result: { totalUsd: 20 }, failed: true })
    time += 1
    store.refresh()
    live[3]!.answer(result(30))
    await settled()
    expect(store.get()).toMatchObject({ result: { totalUsd: 30 }, failed: false })
  })

  it('reads again only once the figures are a minute old, and not while a read runs', async () => {
    let time = 0
    const { source, live } = fakeSource()
    const store = createPortfolioStore(source, { now: () => time })
    store.revalidate()
    store.revalidate()
    expect(live).toHaveLength(1)
    live[0]!.answer(result(20))
    await settled()
    time = REVALIDATE_MS - 1
    store.revalidate()
    expect(live).toHaveLength(1)
    time = REVALIDATE_MS
    store.revalidate()
    expect(live).toHaveLength(2)
    expect(live[1]!.fresh).toBe(false)
    store.refresh()
    expect(live[2]!.fresh).toBe(true)
  })

  it('takes only the latest read’s answer', async () => {
    const { source, live } = fakeSource()
    const store = createPortfolioStore(source)
    store.revalidate()
    store.refresh()
    live[1]!.answer(result(2))
    live[0]!.answer(result(1))
    await settled()
    expect(store.get().result).toMatchObject({ totalUsd: 2 })
  })

  it('forgets everything on a reset, and nothing from before lands after it', async () => {
    const { source, live, giveSaved } = fakeSource(result(10))
    const store = createPortfolioStore(source)
    let told = 0
    store.subscribe(() => told++)
    store.revalidate()
    store.reset()
    giveSaved()
    live[0]!.answer(result(20))
    await settled()
    expect(store.get()).toEqual({ result: null, reading: false, saved: false, failed: false })
    expect(told).toBeGreaterThan(0)
    // The next read asks for the saved copy again.
    store.revalidate()
    expect(live).toHaveLength(2)
  })
})
