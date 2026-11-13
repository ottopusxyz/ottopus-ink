/**
 * Token icons for the page, which may show only its own files and data: URLs. Main fetches
 * an icon Zerion named, from Zerion's own image hosts only, checks it's a small image, and
 * hands it over as a data: URL. Each is kept, so a token's icon is fetched once a session.
 */

/** Where Zerion keeps token icons. Nothing else is fetched. */
export const ICON_HOSTS: readonly string[] = ['cdn.zerion.io', 'token-icons.s3.amazonaws.com']

/** Larger than any token icon needs to be. */
export const MAX_ICON_BYTES = 64 * 1024
const KEPT = 400
const TIMEOUT_MS = 2_500
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** An icon URL worth fetching: https, on one of Zerion's image hosts, and short. Else null. */
export function iconUrlOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ICON_HOSTS.includes(url.hostname) && !url.username && !url.password && !url.port ? url.toString() : null
  } catch {
    return null
  }
}

export interface TokenIcons {
  /** The icon at `url` as a data: URL, or null when it can't be fetched or isn't a small image. */
  icon(url: string): Promise<string | null>
}

export function tokenIcons({ fetch = globalThis.fetch }: { fetch?: typeof globalThis.fetch } = {}): TokenIcons {
  // Answers, misses included, so a broken icon isn't asked for again; and asks under way, shared.
  const kept = new Map<string, Promise<string | null>>()

  const load = async (url: string): Promise<string | null> => {
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'image/*' } })
      const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
      if (!response.ok || !TYPES.has(type) || Number(response.headers.get('content-length') ?? 0) > MAX_ICON_BYTES) return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return null
      return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
    } catch {
      return null
    }
  }

  return {
    icon(value) {
      const url = iconUrlOf(value)
      if (!url) return Promise.resolve(null)
      let answer = kept.get(url)
      if (answer) {
        // Used again: moves to the back, so it's dropped last.
        kept.delete(url)
      } else {
        answer = load(url)
      }
      kept.set(url, answer)
      while (kept.size > KEPT) kept.delete(kept.keys().next().value as string)
      return answer
    },
  }
}
