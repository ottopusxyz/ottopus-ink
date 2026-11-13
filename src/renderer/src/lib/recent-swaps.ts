import { useEffect, useState } from 'react'
import type { RecentSwap } from '../../../shared/ipc'

const SETTLED = new Set(['done', 'refunded', 'failed', 'unknown'])

/**
 * The swaps Home shows: only those still under way, newest first, a few at most. A settled
 * one steps aside: its chat's note says how it ended, and its payout shows in the portfolio.
 */
export function homeSwaps(swaps: readonly RecentSwap[], max = 3): RecentSwap[] {
  return swaps.filter((swap) => !swap.progress || !SETTLED.has(swap.progress.stage)).slice(0, max)
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
