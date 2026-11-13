import { cleanSymbol } from '../../shared/token-text'

/** 1Click, NEAR Intents' swap service. Quotes and its token list need no key; without one it adds its own fee. */
export const ONE_CLICK_URL = 'https://1click.chaindefuser.com'

/** An asset id as 1Click names them: `nep141:wrap.near`, `nep245:…`, or its newer `1cs_v1:…`. */
const ASSET_ID = /^(nep141|nep245|1cs_v1):[A-Za-z0-9._:-]{1,200}$/
const WHOLE = /^(0|[1-9][0-9]{0,77})$/

/** One token 1Click can swap. */
export interface OneClickToken {
  assetId: string
  /** One short word, checked. */
  symbol: string
  decimals: number
  /** 1Click's short name for the chain it lives on: `near`, `base`, `sol`. */
  blockchain: string
  /** Its contract on that chain, or null for the chain's own coin. */
  contract: string | null
  /** Dollars per whole token, when 1Click has a price above zero. */
  usd: number | null
}

/**
 * Every token 1Click lists, except retired ones and second listings: a symbol with a
 * tag such as "(DEPRECATED)" or "(OMNI)" is another route to a token listed plainly too,
 * and a route is never picked by guessing between two. Null when 1Click can't be reached.
 */
export async function oneClickTokens({ fetch = globalThis.fetch, url = ONE_CLICK_URL }: { fetch?: typeof globalThis.fetch; url?: string } = {}): Promise<OneClickToken[] | null> {
  let body: unknown
  try {
    const response = await fetch(`${url}/v0/tokens`, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return null
    body = await response.json()
  } catch {
    return null
  }
  if (!Array.isArray(body)) return null
  const tokens: OneClickToken[] = []
  for (const entry of body) {
    if (typeof entry !== 'object' || entry === null) continue
    const { assetId, symbol, decimals, price, blockchain, contractAddress } = entry as Record<string, unknown>
    const clean = cleanSymbol(symbol)
    if (typeof assetId !== 'string' || !ASSET_ID.test(assetId) || !clean) continue
    if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) continue
    if (typeof blockchain !== 'string' || !/^[a-z0-9]{1,16}$/.test(blockchain)) continue
    const contract = typeof contractAddress === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(contractAddress) ? contractAddress : null
    const usd = typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null
    tokens.push({ assetId, symbol: clean, decimals, blockchain, contract, usd })
  }
  return tokens
}

/** What Ink asks 1Click to quote. Always an exact input: the person says how much they send. */
export interface OneClickQuoteRequest {
  originAsset: string
  destinationAsset: string
  /** In the origin asset's smallest unit. */
  amount: bigint
  /** `ORIGIN_CHAIN`: sent from the wallet on the asset's own chain. `INTENTS`: moved inside the Intents balance. */
  depositType: 'ORIGIN_CHAIN' | 'INTENTS'
  /** The person's own account, where a refund goes: on the origin chain, or in Intents for an Intents deposit. */
  refundTo: string
  recipient: string
  /** `DESTINATION_CHAIN`: paid out on the destination asset's chain. `INTENTS`: kept in the Intents balance. */
  recipientType: 'DESTINATION_CHAIN' | 'INTENTS'
  /** A dry quote moves nothing and gives no deposit address. */
  dry: boolean
  /** When the swap is refunded if it hasn't happened. */
  deadline: Date
  /** 100 is 1%. */
  slippageBps: number
}

export interface OneClickQuote {
  amountIn: bigint
  /** What 1Click expects to pay out, after its fees. */
  amountOut: bigint
  /** The least the swap pays out, or it's refunded. */
  minAmountOut: bigint
  amountInUsd: number | null
  amountOutUsd: number | null
  /** Seconds from the deposit landing to the payout, as 1Click estimates. */
  seconds: number
  /** Taken from the payout for sending it on the destination chain, in its smallest unit. */
  withdrawFee: bigint
  /** 1Click's own fee in basis points, already taken from amountOut. */
  feeBps: number
  /** Only on a quote that isn't dry. */
  depositAddress: string | null
  depositMemo: string | null
  /** Only on a quote that isn't dry: after this the deposit address is dead, and funds sent to it may be lost. */
  deadline: Date | null
}

/**
 * Why a quote didn't come back: `too-small` (under 1Click's minimum), `bad-recipient`
 * (an address 1Click won't pay), `no-route` (1Click turned it down or no market maker
 * quoted), `mismatch` (the answer was for another swap) or `unavailable`.
 */
export type OneClickFailure = 'too-small' | 'bad-recipient' | 'no-route' | 'mismatch' | 'unavailable'

export type OneClickQuoteResult = { ok: true; quote: OneClickQuote } | { ok: false; reason: OneClickFailure }

const bigOf = (value: unknown): bigint | null => (typeof value === 'string' && WHOLE.test(value) ? BigInt(value) : null)
const usdOf = (value: unknown): number | null => {
  const number = typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) && number >= 0 ? number : null
}
const textOf = (value: unknown, pattern: RegExp): string | null => (typeof value === 'string' && pattern.test(value) ? value : null)

/** 1Click's error text is its own words, never passed on: it only picks which of Ink's reasons to give. */
function failureOf(message: unknown): OneClickFailure {
  const text = typeof message === 'string' ? message.toLowerCase() : ''
  if (/too low|too small|minimum|at least/.test(text)) return 'too-small'
  if (/recipient|refund/.test(text) && /valid/.test(text)) return 'bad-recipient'
  return 'no-route'
}

/**
 * Asks 1Click what a swap would pay out now. The answer is checked against the request:
 * the same assets, amount, recipient and refund address, or it isn't used.
 */
export async function oneClickQuote(request: OneClickQuoteRequest, { fetch = globalThis.fetch, url = ONE_CLICK_URL }: { fetch?: typeof globalThis.fetch; url?: string } = {}): Promise<OneClickQuoteResult> {
  const sent = {
    dry: request.dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance: request.slippageBps,
    originAsset: request.originAsset,
    depositType: request.depositType,
    destinationAsset: request.destinationAsset,
    amount: request.amount.toString(),
    refundTo: request.refundTo,
    refundType: request.depositType === 'INTENTS' ? 'INTENTS' : 'ORIGIN_CHAIN',
    recipient: request.recipient,
    recipientType: request.recipientType,
    deadline: request.deadline.toISOString(),
    // Gives market makers a moment to answer, for a better price than the first one in.
    quoteWaitingTimeMs: 3000,
  }
  let response: Response
  let body: unknown
  try {
    response = await fetch(`${url}/v0/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sent),
      signal: AbortSignal.timeout(20_000),
    })
    body = await response.json()
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
  if (typeof body !== 'object' || body === null) return { ok: false, reason: 'unavailable' }
  const answer = body as { quote?: unknown; quoteRequest?: unknown; message?: unknown }
  if (!response.ok) return { ok: false, reason: response.status >= 500 ? 'unavailable' : failureOf(answer.message) }
  if (typeof answer.quote !== 'object' || answer.quote === null || typeof answer.quoteRequest !== 'object' || answer.quoteRequest === null) {
    return { ok: false, reason: 'unavailable' }
  }

  const echoed = answer.quoteRequest as Record<string, unknown>
  const same = ['originAsset', 'destinationAsset', 'amount', 'refundTo', 'recipient', 'depositType', 'recipientType', 'swapType'] as const
  if (same.some((key) => echoed[key] !== sent[key]) || echoed.dry !== request.dry) return { ok: false, reason: 'mismatch' }

  const quote = answer.quote as Record<string, unknown>
  const amountIn = bigOf(quote.amountIn)
  const amountOut = bigOf(quote.amountOut)
  const minAmountOut = bigOf(quote.minAmountOut)
  const seconds = typeof quote.timeEstimate === 'number' && Number.isFinite(quote.timeEstimate) && quote.timeEstimate >= 0 ? quote.timeEstimate : null
  if (amountIn === null || amountOut === null || minAmountOut === null || seconds === null) return { ok: false, reason: 'unavailable' }
  // An exact input: 1Click must take what was asked, and promise no more than it quotes.
  if (amountIn !== request.amount || minAmountOut > amountOut || amountOut === 0n) return { ok: false, reason: 'mismatch' }

  const fees = Array.isArray(echoed.appFees) ? echoed.appFees : []
  const feeBps = fees.reduce((sum: number, fee: unknown) => {
    const bps = typeof fee === 'object' && fee !== null ? (fee as { fee?: unknown }).fee : null
    return sum + (typeof bps === 'number' && Number.isInteger(bps) && bps >= 0 && bps <= 10_000 ? bps : 0)
  }, 0)

  const depositAddress = request.dry ? null : textOf(quote.depositAddress, /^[A-Za-z0-9._:-]{1,128}$/)
  const deadline = request.dry || typeof quote.deadline !== 'string' ? null : new Date(quote.deadline)
  if (!request.dry && (depositAddress === null || deadline === null || Number.isNaN(deadline.getTime()))) return { ok: false, reason: 'unavailable' }
  return {
    ok: true,
    quote: {
      amountIn,
      amountOut,
      minAmountOut,
      amountInUsd: usdOf(quote.amountInUsd),
      amountOutUsd: usdOf(quote.amountOutUsd),
      seconds,
      withdrawFee: bigOf(quote.withdrawFee) ?? 0n,
      feeBps,
      depositAddress,
      depositMemo: request.dry ? null : textOf(quote.depositMemo, /^[A-Za-z0-9._:-]{1,64}$/),
      deadline,
    },
  }
}

/** Where a swap stands, as 1Click reports it. */
export type SwapStage = 'PENDING_DEPOSIT' | 'KNOWN_DEPOSIT_TX' | 'INCOMPLETE_DEPOSIT' | 'PROCESSING' | 'SUCCESS' | 'REFUNDED' | 'FAILED'
const STAGES: readonly SwapStage[] = ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'INCOMPLETE_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED']

export interface SwapReport {
  stage: SwapStage
  /** What was paid out, in the destination token's smallest unit, once known. */
  amountOut: bigint | null
  /** The payout's transaction on the destination chain, once there is one. */
  payoutTx: { hash: string; explorerUrl: string | null } | null
  /** What was refunded, in the origin token's smallest unit, once known. */
  refunded: bigint | null
}

/** An explorer link 1Click gives, only when it's plain https. */
const explorerOf = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 300) return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

function reportOf(body: unknown): SwapReport | null {
  if (typeof body !== 'object' || body === null) return null
  const { status, swapDetails } = body as { status?: unknown; swapDetails?: unknown }
  if (typeof status !== 'string' || !(STAGES as readonly string[]).includes(status)) return null
  const details = typeof swapDetails === 'object' && swapDetails !== null ? (swapDetails as Record<string, unknown>) : {}
  const payouts = Array.isArray(details.destinationChainTxHashes) ? details.destinationChainTxHashes : []
  const first = payouts[0] as { hash?: unknown; explorerUrl?: unknown } | undefined
  const hash = textOf(first?.hash, /^[A-Za-z0-9:_-]{1,128}$/)
  return {
    stage: status as SwapStage,
    amountOut: bigOf(details.amountOut),
    payoutTx: hash ? { hash, explorerUrl: explorerOf(first?.explorerUrl) } : null,
    refunded: bigOf(details.refundedAmount),
  }
}

/**
 * Tells 1Click the deposit's transaction, so it needn't wait to spot it. Only a speed-up:
 * 1Click finds the deposit by itself too. Null when 1Click couldn't be told.
 */
export async function submitDeposit(
  { txHash, depositAddress, nearSenderAccount }: { txHash: string; depositAddress: string; nearSenderAccount?: string },
  { fetch = globalThis.fetch, url = ONE_CLICK_URL }: { fetch?: typeof globalThis.fetch; url?: string } = {},
): Promise<SwapReport | null> {
  try {
    const response = await fetch(`${url}/v0/deposit/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txHash, depositAddress, ...(nearSenderAccount ? { nearSenderAccount } : {}) }),
      signal: AbortSignal.timeout(15_000),
    })
    return response.ok ? reportOf(await response.json()) : null
  } catch {
    return null
  }
}

/** Where the swap behind a deposit address stands now. Null when 1Click can't be read. */
export async function swapStatus(depositAddress: string, { fetch = globalThis.fetch, url = ONE_CLICK_URL }: { fetch?: typeof globalThis.fetch; url?: string } = {}): Promise<SwapReport | null> {
  try {
    const response = await fetch(`${url}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, { signal: AbortSignal.timeout(15_000) })
    return response.ok ? reportOf(await response.json()) : null
  } catch {
    return null
  }
}
