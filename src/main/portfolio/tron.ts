/** TronGrid, Tron's public API. No key is needed at the rate one wallet reads. */
export const TRONGRID_URL = 'https://api.trongrid.io'

/** A Tron address: base58, starting with T. */
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

const WHOLE = /^(0|[1-9][0-9]*)$/

/** More tokens than anyone holds on purpose. Past this the rest are airdrops, and they aren't read. */
const MAX_TOKENS = 200

export interface TronHoldings {
  /** TRX in sun (10^-6 TRX): what the account can spend, plus what it froze for energy and bandwidth, which is still its own. */
  trx: bigint
  /** Each TRC-20 token with a balance above zero, by contract. */
  tokens: { contract: string; raw: bigint }[]
}

type Fetch = typeof globalThis.fetch

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const whole = (value: unknown): bigint | null => {
  const text = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value
  return typeof text === 'string' && WHOLE.test(text) ? BigInt(text) : null
}

/**
 * What a Tron address holds, from TronGrid: its TRX and every TRC-20 token. An address
 * nothing was ever sent to holds nothing. Null when TronGrid can't be read. Anyone can
 * send a TRC-20 token, so the tokens are only a list to look prices up for.
 */
export async function tronHoldings(address: string, { fetch = globalThis.fetch, url = TRONGRID_URL }: { fetch?: Fetch; url?: string } = {}): Promise<TronHoldings | null> {
  if (!TRON_ADDRESS.test(address)) return null
  let body: unknown
  try {
    const response = await fetch(`${url}/v1/accounts/${address}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return null
    body = await response.json()
  } catch {
    return null
  }
  if (!isRecord(body) || !Array.isArray(body.data)) return null
  const account = body.data[0]
  // TronGrid answers an address it has never seen with no account at all.
  if (account === undefined) return { trx: 0n, tokens: [] }
  if (!isRecord(account)) return null

  let trx = whole(account.balance ?? 0)
  if (trx === null) return null
  for (const frozen of Array.isArray(account.frozenV2) ? account.frozenV2 : []) {
    const amount = isRecord(frozen) ? whole(frozen.amount ?? 0) : null
    if (amount !== null) trx += amount
  }

  const tokens = new Map<string, bigint>()
  for (const entry of Array.isArray(account.trc20) ? account.trc20 : []) {
    if (!isRecord(entry)) continue
    for (const [contract, amount] of Object.entries(entry)) {
      const raw = whole(amount)
      if (!TRON_ADDRESS.test(contract) || raw === null || raw === 0n || tokens.has(contract)) continue
      tokens.set(contract, raw)
    }
    if (tokens.size >= MAX_TOKENS) break
  }
  return { trx, tokens: [...tokens].map(([contract, raw]) => ({ contract, raw })) }
}
