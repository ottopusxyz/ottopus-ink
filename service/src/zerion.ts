/** Zerion's API, the only place this service sends Ottopus's key. */
export const ZERION_URL = 'https://api.zerion.io/v1'

/** Pages of positions followed, at most. Zerion sends one for nearly every wallet. */
const MAX_PAGES = 5

/** The query Ink's reader needs, fixed here so a caller can't widen what the key is spent on. */
const QUERY = new URLSearchParams({ currency: 'usd', 'filter[positions]': 'only_simple', 'filter[trash]': 'only_non_trash', sort: '-value' }).toString()

export type ZerionAnswer =
  | { kind: 'ok'; data: unknown[] }
  /** Zerion doesn't read this kind of address. */
  | { kind: 'untracked' }
  /** Zerion's limit for the key is used up; `retryAfter` in seconds when it said. */
  | { kind: 'rate-limited'; retryAfter: number | null }
  /** No usable answer, or Zerion refused Ottopus's key. Callers see the same thing either way. */
  | { kind: 'unavailable' }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const pick = (value: unknown, keys: readonly string[]): Record<string, unknown> | undefined =>
  isRecord(value) ? Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]])) : undefined

/**
 * A position cut down to what Ink reads: amount, value, price, the day's change, the token's
 * symbol, whether Zerion knows it, its address on each chain, and the chain. Icons, names,
 * links and anything else Zerion adds stay behind.
 */
export function trimPosition(item: unknown): unknown {
  if (!isRecord(item) || !isRecord(item.attributes)) return null
  const attributes = item.attributes
  const fungible = isRecord(attributes.fungible_info) ? attributes.fungible_info : {}
  const implementations = Array.isArray(fungible.implementations) ? fungible.implementations.map((entry) => pick(entry, ['chain_id', 'address', 'decimals'])).filter(Boolean) : []
  const chain = isRecord(item.relationships) && isRecord(item.relationships.chain) && isRecord(item.relationships.chain.data) ? item.relationships.chain.data.id : undefined
  return {
    attributes: {
      quantity: pick(attributes.quantity, ['int', 'decimals']),
      value: attributes.value,
      price: attributes.price,
      changes: pick(attributes.changes, ['percent_1d']),
      flags: pick(attributes.flags, ['displayable']),
      fungible_info: { symbol: fungible.symbol, flags: pick(fungible.flags, ['verified']), implementations },
    },
    relationships: { chain: { data: { id: chain } } },
  }
}

/** One wallet's positions from Zerion, every page of them, trimmed. */
export async function zerionPositions(address: string, { key, fetch }: { key: string; fetch: typeof globalThis.fetch }): Promise<ZerionAnswer> {
  const authorization = `Basic ${btoa(`${key}:`)}`
  let next: string | null = `${ZERION_URL}/wallets/${encodeURIComponent(address)}/positions/?${QUERY}`
  const data: unknown[] = []
  for (let page = 0; next && page < MAX_PAGES; page++) {
    let response: Response
    try {
      response = await fetch(next, { headers: { authorization, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    } catch {
      return { kind: 'unavailable' }
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'))
      return { kind: 'rate-limited', retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds : null }
    }
    if (response.status === 400 || response.status === 404 || response.status === 422) {
      const detail = await response.text().catch(() => '')
      return /not trackable|not tracked|invalid address|unsupported/i.test(detail) ? { kind: 'untracked' } : { kind: 'unavailable' }
    }
    if (!response.ok) return { kind: 'unavailable' }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { kind: 'unavailable' }
    }
    if (!isRecord(body) || !Array.isArray(body.data)) return { kind: 'unavailable' }
    data.push(...body.data.map(trimPosition).filter(Boolean))
    const link = isRecord(body.links) ? body.links.next : null
    // Only a page on Zerion is followed, so the key goes nowhere else.
    next = typeof link === 'string' && link.startsWith(`${ZERION_URL}/`) && link !== next ? link : null
  }
  return { kind: 'ok', data }
}

/** Tokens a search gives back, at most. Enough for a dropdown. */
const MAX_FUNGIBLES = 20

/**
 * A token from Zerion's list cut down to what Ink shows: its symbol and name, whether
 * Zerion verified it, and its address and decimals on the chain asked about. Icons,
 * prices and the rest stay behind.
 */
/** Where Zerion keeps token icons. Ink fetches icons from these alone, so others are dropped here too. */
const ICON_HOSTS = ['cdn.zerion.io', 'token-icons.s3.amazonaws.com']

/** A token's icon URL when it's https on one of Zerion's image hosts, else null. */
function iconUrl(icon: unknown): string | null {
  if (!isRecord(icon) || typeof icon.url !== 'string' || icon.url.length > 300) return null
  try {
    const url = new URL(icon.url)
    return url.protocol === 'https:' && ICON_HOSTS.includes(url.hostname) && !url.username && !url.password && !url.port ? url.toString() : null
  } catch {
    return null
  }
}

export function trimFungible(item: unknown, chain: string): unknown {
  if (!isRecord(item) || !isRecord(item.attributes)) return null
  const attributes = item.attributes
  const implementations = Array.isArray(attributes.implementations) ? attributes.implementations.filter((entry) => isRecord(entry) && entry.chain_id === chain).map((entry) => pick(entry, ['chain_id', 'address', 'decimals'])) : []
  if (implementations.length === 0) return null
  const icon = iconUrl(attributes.icon)
  return { attributes: { symbol: attributes.symbol, name: attributes.name, flags: pick(attributes.flags, ['verified']), ...(icon ? { icon: { url: icon } } : {}), implementations } }
}

/** Tokens on one chain whose name or symbol matches, largest by market cap first, trimmed. */
export async function zerionFungibles(query: string, chain: string, { key, fetch }: { key: string; fetch: typeof globalThis.fetch }): Promise<ZerionAnswer> {
  const params = new URLSearchParams({ 'filter[search_query]': query, 'filter[implementation_chain_id]': chain, 'page[size]': String(MAX_FUNGIBLES), sort: '-market_data.market_cap', currency: 'usd' })
  let response: Response
  try {
    response = await fetch(`${ZERION_URL}/fungibles/?${params.toString()}`, { headers: { authorization: `Basic ${btoa(`${key}:`)}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  } catch {
    return { kind: 'unavailable' }
  }
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'))
    return { kind: 'rate-limited', retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds : null }
  }
  if (!response.ok) return { kind: 'unavailable' }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: 'unavailable' }
  }
  if (!isRecord(body) || !Array.isArray(body.data)) return { kind: 'unavailable' }
  return { kind: 'ok', data: body.data.map((item) => trimFungible(item, chain)).filter(Boolean).slice(0, MAX_FUNGIBLES) }
}
