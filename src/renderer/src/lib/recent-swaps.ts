import { useEffect, useState } from 'react'
import type { RecentSwap } from '../../../shared/ipc'

/** How long a settled swap stays on Home after it started. */
export const SETTLED_SHOWN_MS = 30 * 60_000

const SETTLED = new Set(['done', 'refunded', 'failed', 'unknown'])

/** The swaps Home shows: every one still under way, then those settled lately, newest first, a few at most. */
export function homeSwaps(swaps: readonly RecentSwap[], now: number, max = 3): RecentSwap[] {
  return swaps.filter((swap) => !swap.progress || !SETTLED.has(swap.progress.stage) || now - swap.startedAt < SETTLED_SHOWN_MS).slice(0, max)
}

/**
 * The swaps Ink followed lately, newest first, read again whenever one moves on or Ink
 * locks or unlocks. Main gives none while Ink is locked.
 */
export function useRecentSwaps(): RecentSwap[] {
  const [swaps, setSwaps] = useState<RecentSwap[]>([])
  useEffect(() => {
    let live = true
    const read = () =>
      void window.ink.recentSwaps().then(
        (next) => {
          if (live) setSwaps(next)
        },
        () => undefined,
      )
    read()
    const offSwaps = window.ink.onSwapsChanged(read)
    const offVault = window.ink.onVaultStatus(read)
    return () => {
      live = false
      offSwaps()
      offVault()
    }
  }, [])
  return swaps
}
