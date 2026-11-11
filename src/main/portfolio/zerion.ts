import { cleanSymbol } from '../../shared/token-text'

/** Zerion's API. Every call carries the person's own key; Ink ships none. */
export const ZERION_URL = 'https://api.zerion.io/v1'

/**
 * - `bad-key`: Zerion turned the key down.
 * - `rate-limited`: the key's quota ran out for now.
 * - `untracked`: Zerion doesn't read this kind of address.
 * - `unavailable`: no answer, or one Ink can't use.
 */
export type ZerionFailure = 'bad-key' | 'rate-limited' | 'untracked' | 'unavailable'

export class ZerionError extends Error {
  override name = 'ZerionError'
  constructor(readonly reason: ZerionFailure) {
    super(`Zerion: ${reason}`)
  }
}

/** Which of Ink's accounts a Zerion chain belongs to: one EVM address covers every EVM chain. */
export type ZerionGroup = 'evm' | 'solana' | 'tron'

export interface ZerionHolding {
  /** Zerion's name for the chain: `base`, `solana`. */
  network: string
  /** As a person reads it: "Base", "BNB Chain". */
  networkName: string
  group: ZerionGroup
  /** The token's address on that chain, or null for the chain's own coin. */
  contract: string | null
  symbol: string
  decimals: number
  /** In the token's smallest unit. Never zero. */
  raw: bigint
  usdPrice: number | null
  usdValue: number | null
  change24h: number | null
  /** Zerion lists it as a known token, not only as not-spam. */
  verified: boolean
}

type Fetch = typeof globalThis.fetch

export interface ZerionOptions {
  key: string
  fetch?: Fetch
  url?: string
}

/** Pages of positions followed, at most. Zerion sends one for nearly every wallet. */
const MAX_PAGES = 5

/** The names Zerion's slugs stand for, where a slug doesn't read well capitalised. */
const NAMES: Record<string, string> = {
  'binance-smart-chain': 'BNB Chain',
  xdai: 'Gnosis',
  'zksync-era': 'zkSync Era',
  'polygon-zkevm': 'Polygon zkEVM',
  hyperevm: 'HyperEVM',
  opbnb: 'opBNB',
  megaeth: 'MegaETH',
}

export function networkName(slug: string): string {
  return NAMES[slug] ?? slug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

const groupOf = (slug: string): ZerionGroup => (slug === 'solana' ? 'solana' : slug === 'tron' ? 'tron' : 'evm')

async function zerionGet(path: string, { key, fetch = globalThis.fetch, url = ZERION_URL }: ZerionOptions): Promise<unknown> {
  const target = path.startsWith('https://') ? path : `${url}${path}`
  // Basic auth with the key as the user name and no password. The colon is what makes it a credential.
  const authorization = `Basic ${Buffer.from(`${key}:`).toString('base64')}`
  for (let attempt = 1; ; attempt++) {
    let response: Response
    try {
      response = await fetch(target, { headers: { authorization, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    } catch {
      throw new ZerionError('unavailable')
    }
    if (response.ok) {
      try {
        return (await response.json()) as unknown
      } catch {
        throw new ZerionError('unavailable')
      }
    }
    if (response.status === 401 || response.status === 403) throw new ZerionError('bad-key')
    if (response.status === 400 || response.status === 404 || response.status === 422) {
      const detail = await response.text().catch(() => '')
      throw new ZerionError(/not trackable|not tracked|invalid address|unsupported/i.test(detail) ? 'untracked' : 'unavailable')
    }
    if (response.status === 429) {
      // Only the per-second limit clears inside a request; a day's quota doesn't.
      const wait = Number(response.headers.get('retry-after') ?? '1') * 1000
      if (attempt >= 2 || !Number.isFinite(wait) || wait > 2_000) throw new ZerionError('rate-limited')
      await new Promise((resolve) => setTimeout(resolve, Math.max(wait, 100)))
      continue
    }
    throw new ZerionError('unavailable')
  }
}

/** Whether Zerion takes the key: one small call, made before the key is saved. */
export async function checkZerionKey(options: ZerionOptions): Promise<'ok' | 'bad-key' | 'unavailable'> {
  try {
    await zerionGet('/chains/', options)
    return 'ok'
  } catch (error) {
    return error instanceof ZerionError && error.reason === 'bad-key' ? 'bad-key' : 'unavailable'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** One position as Ink keeps it, or null for anything it can't name honestly: no chain, no symbol fit to show, no exact amount. */
export function toHolding(item: unknown): ZerionHolding | null {
  if (!isRecord(item) || !isRecord(item.attributes)) return null
  const attributes = item.attributes
  const network = isRecord(item.relationships) && isRecord(item.relationships.chain) && isRecord(item.relationships.chain.data) ? item.relationships.chain.data.id : null
  if (typeof network !== 'string' || !/^[a-z0-9-]{1,40}$/.test(network)) return null
  if (isRecord(attributes.flags) && attributes.flags.displayable === false) return null

  const fungible = isRecord(attributes.fungible_info) ? attributes.fungible_info : null
  const symbol = cleanSymbol(fungible?.symbol)
  const quantity = isRecord(attributes.quantity) ? attributes.quantity : null
  const amount = quantity?.int
  const decimals = quantity?.decimals
  if (!fungible || !symbol || typeof amount !== 'string' || !/^[0-9]+$/.test(amount) || /^0+$/.test(amount)) return null
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null

  const implementations = Array.isArray(fungible.implementations) ? fungible.implementations.filter(isRecord) : []
  const here = implementations.find((implementation) => implementation.chain_id === network)
  // No address for this chain, or an empty one, is the chain's own coin.
  const address = here && typeof here.address === 'string' && here.address !== '' ? here.address : null
  const changes = isRecord(attributes.changes) ? attributes.changes : null
  const percent = finite(changes?.percent_1d)

  return {
    network,
    networkName: networkName(network),
    group: groupOf(network),
    contract: address,
    symbol,
    decimals,
    raw: BigInt(amount),
    usdPrice: finite(attributes.price),
    usdValue: finite(attributes.value),
    change24h: percent === null ? null : percent / 100,
    verified: isRecord(fungible.flags) && fungible.flags.verified === true,
  }
}

/**
 * What one address holds on every chain Zerion reads for it: an EVM address answers for
 * every EVM chain at once. Wallet balances only, with Zerion's spam filter on, most
 * valuable first. Throws a ZerionError when Zerion can't answer.
 */
export async function zerionHoldings(address: string, options: ZerionOptions): Promise<ZerionHolding[]> {
  const query = new URLSearchParams({ currency: 'usd', 'filter[positions]': 'only_simple', 'filter[trash]': 'only_non_trash', sort: '-value' })
  const base = options.url ?? ZERION_URL
  let next: string | null = `/wallets/${encodeURIComponent(address)}/positions/?${query}`
  const holdings: ZerionHolding[] = []
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const body = await zerionGet(next, options)
    if (!isRecord(body) || !Array.isArray(body.data)) throw new ZerionError('unavailable')
    for (const item of body.data) {
      const holding = toHolding(item)
      if (holding) holdings.push(holding)
    }
    const link = isRecord(body.links) ? body.links.next : null
    // Only a link back to Zerion is followed, so the key never goes anywhere else.
    next = typeof link === 'string' && link.startsWith(`${base}/`) && link !== next ? link : null
  }
  return holdings
}
