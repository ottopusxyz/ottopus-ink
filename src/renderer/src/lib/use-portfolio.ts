import { useCallback, useEffect, useRef, useState } from 'react'
import type { PortfolioResult } from '../../../shared/portfolio'

export interface PortfolioState {
  /** Null until the first read answers. */
  result: PortfolioResult | null
  /** A read is under way: the first, or a refresh over figures already shown. */
  reading: boolean
  /** The last refresh failed, so the figures shown are from before it. */
  stale: boolean
  /** Reads again rather than taking main's read from the last minute. */
  refresh: () => void
}

const FAILED: PortfolioResult = { ok: false, reason: 'unavailable' }

/**
 * What the wallet holds, read when the component mounts. Main keeps a read for a
 * minute, so Home and the Portfolio page asking one after the other cost one read.
 * A refresh keeps the figures on screen until the new ones arrive.
 */
export function usePortfolio(): PortfolioState {
  const [result, setResult] = useState<PortfolioResult | null>(null)
  const [reading, setReading] = useState(true)
  const [stale, setStale] = useState(false)
  const asked = useRef(0)
  const shown = useRef<PortfolioResult | null>(null)

  /** A failed refresh keeps the figures already shown, and says they're from before. */
  const settle = (answer: PortfolioResult) => {
    setReading(false)
    if (!answer.ok && shown.current?.ok) return setStale(true)
    shown.current = answer
    setResult(answer)
    setStale(false)
  }

  const request = useCallback((fresh: boolean) => {
    const ask = ++asked.current
    window.ink.portfolio({ fresh }).then(
      (answer) => {
        if (ask === asked.current) settle(answer)
      },
      (error: unknown) => {
        console.error('Could not read the portfolio', error)
        if (ask === asked.current) settle(FAILED)
      },
    )
  }, [])

  useEffect(() => {
    request(false)
    const counter = asked
    return () => {
      // An answer arriving after unmount is dropped.
      counter.current++
    }
  }, [request])

  const refresh = useCallback(() => {
    setReading(true)
    request(true)
  }, [request])

  return { result, reading, stale, refresh }
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
