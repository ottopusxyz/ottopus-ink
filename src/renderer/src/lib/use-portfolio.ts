import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PortfolioResult } from '../../../shared/portfolio'
import { BACKGROUND_MS, createPortfolioStore, type PortfolioStore } from './portfolio-store'

export interface PortfolioState {
  /** Null until something is known: the saved copy from before, or a live read. */
  result: PortfolioResult | null
  /** A read is under way: the first, or one behind figures already shown. */
  reading: boolean
  /** The figures shown were kept from before, and haven't been read again yet. */
  saved: boolean
  /** The last read failed, so the figures shown are from before it. */
  stale: boolean
  /** Reads again rather than taking main's read from the last minute. */
  refresh: () => void
}

let store: PortfolioStore | null = null

/** The page's one store, made on first use. Locking forgets it, so nothing shows behind the lock screen or after it. */
function portfolioStore(): PortfolioStore {
  if (!store) {
    const made = createPortfolioStore(window.ink)
    window.ink.onVaultStatus((status) => {
      if (status.state !== 'unlocked') made.reset()
    })
    store = made
  }
  return store
}

/**
 * What the wallet holds, shared by every screen that shows it. It shows the last
 * figures at once, the saved copy from before on the first read, and reads again
 * behind them: when a screen opens, when Ink's window comes back to the front, and
 * every two minutes while the window is in view, each time only once the figures
 * are a minute old.
 */
export function usePortfolio(): PortfolioState {
  const shared = portfolioStore()
  const snapshot = useSyncExternalStore(shared.subscribe, shared.get)

  useEffect(() => {
    shared.revalidate()
    const onFocus = () => shared.revalidate()
    window.addEventListener('focus', onFocus)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') shared.revalidate()
    }, BACKGROUND_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(timer)
    }
  }, [shared])

  return { result: snapshot.result, reading: snapshot.reading, saved: snapshot.saved, stale: snapshot.failed, refresh: shared.refresh }
}

/** The time now, moved on every so often, for "read 40 seconds ago". */
export function useNow(everyMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}
