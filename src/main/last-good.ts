/**
 * A list read from a slow service, kept so a failed or slow read doesn't lose it:
 * - a copy younger than `maxAgeMs` is used as it is;
 * - an older one is used at once while a new read runs behind it, and replaced when that
 *   read succeeds; a read that fails (null) or throws leaves it as it was;
 * - with no copy yet, the caller waits for the read, and gets null if it fails.
 * Only one read runs at a time; callers meanwhile share it.
 */
export function lastGood<T>(read: () => Promise<T | null>, { maxAgeMs, now = Date.now }: { maxAgeMs: number; now?: () => number }): () => Promise<T | null> {
  let kept: { at: number; value: T } | null = null
  let reading: Promise<T | null> | null = null

  const refresh = (): Promise<T | null> => {
    reading ??= read()
      .catch(() => null)
      .then((value) => {
        if (value !== null) kept = { at: now(), value }
        return value ?? kept?.value ?? null
      })
      .finally(() => {
        reading = null
      })
    return reading
  }

  return () => {
    if (kept && now() - kept.at <= maxAgeMs) return Promise.resolve(kept.value)
    if (kept) {
      void refresh()
      return Promise.resolve(kept.value)
    }
    return refresh()
  }
}
