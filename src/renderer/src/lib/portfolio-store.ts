import type { PortfolioResult } from '../../../shared/portfolio'

/** Figures older than this are read again when a screen showing them opens, or Ink's window comes back to the front. */
export const REVALIDATE_MS = 60_000

/** While a screen shows the figures, they're read again this often, if the window is in view. */
export const BACKGROUND_MS = 2 * 60_000

export interface PortfolioSnapshot {
  /** Null until something is known: a saved read or a live one. */
  result: PortfolioResult | null
  /** A read is under way, the first or one behind figures already shown. */
  reading: boolean
  /** The figures shown were kept from before, and this run hasn't read them again yet. */
  saved: boolean
  /** The last read failed, so the figures shown are from before it. */
  failed: boolean
}

/** What the store needs from the preload bridge. */
export interface PortfolioSource {
  portfolio(options?: { fresh?: boolean }): Promise<PortfolioResult>
  savedPortfolio(): Promise<PortfolioResult | null>
}

export interface PortfolioStore {
  get(): PortfolioSnapshot
  subscribe(listener: () => void): () => void
  /** Reads again when nothing is under way and the figures are a minute old, or there are none. */
  revalidate(): void
  /** Reads again now, past main's one-minute cache. */
  refresh(): void
  /** Forgets everything, as when Ink locks. */
  reset(): void
}

const EMPTY: PortfolioSnapshot = { result: null, reading: false, saved: false, failed: false }
const FAILED: PortfolioResult = { ok: false, reason: 'unavailable' }

/**
 * The page's one copy of the portfolio, shared by Home and the Portfolio screen, so
 * moving between them shows the figures at once. The first read shows the saved copy
 * from before while the live one runs, and a read that fails keeps what's shown.
 */
export function createPortfolioStore(source: PortfolioSource, { now = Date.now }: { now?: () => number } = {}): PortfolioStore {
  let snapshot = EMPTY
  const listeners = new Set<() => void>()
  /** Each read's number, so only the latest one's answer counts. */
  let asked = 0
  /** Bumped by a reset, so nothing from before it lands after it. */
  let epoch = 0
  /** When a live read last answered; null for never. */
  let answeredAt: number | null = null
  let triedSaved = false

  const set = (next: Partial<PortfolioSnapshot>) => {
    snapshot = { ...snapshot, ...next }
    for (const listener of listeners) listener()
  }

  const settle = (answer: PortfolioResult) => {
    answeredAt = now()
    if (!answer.ok && snapshot.result?.ok) set({ reading: false, failed: true })
    else set({ result: answer, reading: false, saved: false, failed: false })
  }

  const read = (fresh: boolean) => {
    const ask = ++asked
    const at = epoch
    set({ reading: true })
    if (!triedSaved && snapshot.result === null) {
      triedSaved = true
      source.savedPortfolio().then(
        (saved) => {
          // Only before any live answer: a saved copy never replaces newer figures.
          if (saved?.ok && at === epoch && snapshot.result === null) set({ result: saved, saved: true })
        },
        () => undefined,
      )
    }
    source.portfolio({ fresh }).then(
      (answer) => {
        if (ask === asked && at === epoch) settle(answer)
      },
      (error: unknown) => {
        console.error('Could not read the portfolio', error)
        if (ask === asked && at === epoch) settle(FAILED)
      },
    )
  }

  return {
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    revalidate() {
      if (!snapshot.reading && (answeredAt === null || now() - answeredAt >= REVALIDATE_MS)) read(false)
    },
    refresh: () => read(true),
    reset() {
      epoch++
      asked++
      answeredAt = null
      triedSaved = false
      snapshot = EMPTY
      for (const listener of listeners) listener()
    },
  }
}
