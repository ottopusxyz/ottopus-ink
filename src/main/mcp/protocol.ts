import type { Account, AccountChain } from '../../shared/accounts'
import type { ChatPlan, ChatSwap } from '../../shared/ipc'
import type { PlanIntent, PlanStatus, PlanSummary, PlanToolResult, PlanTools } from '../../shared/plan'
import type { HoldingGroup, PortfolioGap, PortfolioResult, TokenHolding, ZerionState } from '../../shared/portfolio'
import type { VaultResult } from '../../shared/vault'
import type { QuoteAmount, QuoteOutcome } from '../routes/quoter'
import { chainName, type RouteAsk } from '../routes/route'

/** The server's name in the agent's tool names (`mcp__ottopus-ink__*`). Not `ottopus`: that's another product's connector. */
export const MCP_SERVER_NAME = 'ottopus-ink'

/** Newest first. Tools work the same in all of them, so any the client asks for is fine. */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

function objectSchema(properties: Record<string, object>, required: string[] = []): object {
  return { type: 'object', properties, required, additionalProperties: false }
}

const text = { type: 'string' }
const planId = objectSchema({ plan_id: text }, ['plan_id'])

/** Names of assets and chains, never an adapter or route: the app picks those. */
const TOOLS = [
  {
    name: 'get_accounts',
    description: "The wallet's address on each chain.",
    inputSchema: objectSchema({}),
  },
  {
    name: 'get_portfolio',
    description: 'What the wallet holds and what it is worth, optionally on one chain: near, intents (the NEAR Intents balance), evm, solana, tron, or a chain such as base.',
    inputSchema: objectSchema({ chain: text }),
  },
  {
    name: 'get_quote',
    description:
      'What a send, swap or bridge would give right now, by the route Ink would take: a direct transfer, or through NEAR Intents. Moves nothing. from_chain intents pays from the NEAR Intents balance; to_chain intents keeps the result there. The amount is in whole tokens.',
    inputSchema: objectSchema(
      { from_asset: text, from_chain: text, to_asset: text, to_chain: text, amount: text },
      ['from_asset', 'to_asset', 'amount'],
    ),
  },
  {
    name: 'create_plan',
    description: 'Proposes a send, swap or stake for the person to review and sign. You cannot sign it, and it moves nothing by itself.',
    inputSchema: objectSchema(
      {
        outcome: { type: 'string', enum: ['send', 'swap', 'stake'] },
        asset: text,
        chain: text,
        amount: text,
        to: text,
        to_asset: text,
        to_chain: text,
      },
      ['outcome', 'asset', 'amount'],
    ),
  },
  { name: 'get_plan', description: 'What became of a plan.', inputSchema: planId },
  { name: 'cancel_plan', description: 'Withdraws a plan that has not been signed.', inputSchema: planId },
]

const toolAnswer = (answer: string, isError = false) => ({ content: [{ type: 'text', text: answer }], isError })

/** get_accounts' answer when there is no wallet on this computer yet. */
const NOT_SET_UP = toolAnswer('The wallet is not set up yet.')

/**
 * What each tool that isn't built yet says. Each is true whatever state the wallet is
 * in, so it never contradicts get_accounts in the same chat.
 */
const NOT_BUILT: Record<string, ReturnType<typeof toolAnswer>> = {
  get_portfolio: toolAnswer('Ink can’t read balances yet.'),
  get_quote: toolAnswer('Ink can’t get quotes yet.'),
  get_plan: toolAnswer('Ink can’t track plans yet.'),
  cancel_plan: toolAnswer('Ink can’t track plans yet, so there is nothing to cancel. Nothing was signed.'),
  create_plan: toolAnswer('Ink can’t make plans yet.'),
}

/** What each address is for, so an agent doesn't send a token to the wrong chain's address. */
const CHAIN_LABELS: Record<AccountChain, string> = {
  near: 'NEAR. Also the NEAR Intents account',
  evm: 'one address for Base, Ethereum, Arbitrum and the other EVM chains',
  solana: 'Solana',
  bitcoin: 'Bitcoin, native SegWit',
  tron: 'Tron',
  sui: 'Sui',
  aptos: 'Aptos',
}

/** What the app can tell an agent. Main passes these in, so this code never reaches the vault itself. */
export interface McpHandlers {
  /** Gets each plan the session's agent proposes. */
  onPlan?: (plan: ChatPlan) => void
  /** The wallet's public addresses, or why there are none. */
  accounts?: () => Promise<VaultResult<{ accounts: Account[] }>>
  /** This chat's plans, which main owns. */
  plans?: PlanTools
  /** What the wallet holds, read from each chain by main. */
  portfolio?: () => Promise<PortfolioResult>
  /** What a payment would give by the route main picks. */
  quote?: (ask: RouteAsk) => Promise<QuoteOutcome>
}

/** How each status reads to an agent. */
const STATUS_WORDS: Record<PlanStatus, string> = {
  draft: 'a draft',
  awaiting_review: 'waiting for the person to review it',
  approved: 'approved by the person',
  signing: 'being signed',
  submitted: 'submitted to the chain',
  confirmed: 'confirmed',
  failed: 'failed',
  cancelled: 'cancelled',
  expired: 'expired',
  blocked: 'blocked by a safety rule',
}

/** Where a swap stands once its deposit landed, for get_plan. Main wrote every value from NEAR Intents' report. */
const SWAP_WORDS: Record<ChatSwap['stage'], (swap: ChatSwap) => string> = {
  deposited: () => 'NEAR ran the deposit; NEAR Intents is picking it up.',
  swapping: () => 'NEAR Intents is swapping it now.',
  done: (swap) => `NEAR Intents finished the swap${swap.got ? ` and paid out ${swap.got}` : ''}.`,
  refunded: (swap) => `NEAR Intents couldn’t swap it and refunded ${swap.refunded ?? 'it'} to the NEAR account.`,
  failed: () => 'NEAR Intents couldn’t finish the swap; any refund goes to the NEAR account.',
  unknown: () => 'Ink stopped checking; NEAR Intents still finishes or refunds it on its own.',
}

/** Why a plan tool said no, worded for the agent to act on. */
function planRefusal(result: Extract<PlanToolResult, { ok: false }>, id: string | null): object {
  switch (result.reason) {
    case 'recipient-not-allowed':
      return toolAnswer('Ink only pays the person’s own address on the chain the funds land on, or an address they typed themselves in this chat. Name the chain, or ask them to type the address.', true)
    case 'too-many':
      return toolAnswer('Too many plans at once. Wait a minute, then try again.', true)
    case 'not-found':
      return toolAnswer('There is no plan with that id in this chat.', true)
    case 'cannot-move':
      return result.status === 'cancelled'
        ? toolAnswer(`Plan ${id} is already cancelled.`, true)
        : toolAnswer(`Plan ${id} is ${STATUS_WORDS[result.status ?? 'draft']}, so it can’t be cancelled.`, true)
    case 'insufficient-funds':
      return toolAnswer('The wallet can’t cover that amount and the network fee. Check get_portfolio, then ask the person to send less or add funds.', true)
    case 'recipient-unknown':
      return toolAnswer('That account doesn’t exist on the chain, so nothing sent to it would arrive. Check the name with the person.', true)
    case 'chain-unavailable':
      return toolAnswer('Ink couldn’t reach the chain to build the plan. Try again in a moment.', true)
    case 'no-route':
      return toolAnswer('NEAR Intents wouldn’t quote this swap right now: the amount may be under its minimum, or no market maker answered. Check with get_quote, then try again.', true)
    case 'locked':
      return toolAnswer('Ink is locked. Ask the person to unlock Ink, then try again.', true)
    case 'no-vault':
      return NOT_SET_UP
    case 'bad-request':
      return toolAnswer(PLAN_SCHEMA_HELP, true)
    default:
      return toolAnswer('Ink couldn’t do that right now. Try again.', true)
  }
}

/** What the chat's plan card shows. */
const chatPlanOf = ({ id, intent }: PlanSummary): ChatPlan => ({
  id,
  status: 'draft',
  outcome: intent.outcome,
  asset: intent.asset,
  amount: intent.amount,
  chain: intent.chain,
  to: intent.to,
  toAsset: intent.toAsset,
  toChain: intent.toChain,
})

const PLAN_SCHEMA_HELP =
  'Those plan details do not match the schema. Each value must be one word of plain ASCII, the amount a plain decimal above zero, a send needs to, and a swap needs to_asset.'

/** A plan id as the store makes them. */
const PLAN_ID = /^[0-9a-f-]{1,64}$/

function planIdFrom(args: unknown): string | null {
  return isRecord(args) && typeof args.plan_id === 'string' && PLAN_ID.test(args.plan_id) ? args.plan_id : null
}

async function planAnswer(work: () => Promise<PlanToolResult>, id: string | null, said: (plan: PlanSummary) => string): Promise<{ answer: object; plan: PlanSummary | null }> {
  let result: PlanToolResult
  try {
    result = await work()
  } catch {
    return { answer: toolAnswer('Ink couldn’t do that right now. Try again.', true), plan: null }
  }
  return result.ok ? { answer: toolAnswer(said(result.plan)), plan: result.plan } : { answer: planRefusal(result, id), plan: null }
}

/** Token lines in one get_portfolio answer, most valuable first. */
const MAX_TOKEN_LINES = 20

const GAP_LINES: Record<PortfolioGap, string> = {
  tokens: 'The list of tokens couldn’t be read, so tokens may be missing.',
  prices: 'Prices couldn’t be read, so there are no dollar values.',
  reviews: 'Some tokens couldn’t be checked with the price service, so they aren’t counted.',
  intents: 'The NEAR Intents balance couldn’t be read, so it may be missing.',
  tron: 'The Tron account couldn’t be read, so it may be missing.',
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** Dollars as a person reads them: $1,234.56, or under a cent as such. */
function dollars(value: number): string {
  return value > 0 && value < 0.01 ? 'under $0.01' : USD.format(value)
}

function change(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return ''
  const percent = Math.abs(fraction * 100).toFixed(1)
  return percent === '0.0' ? ', unchanged today' : `, ${fraction > 0 ? 'up' : 'down'} ${percent}% today`
}

/** Chains a get_portfolio filter can name that Ink doesn't read at all yet. */
const UNREAD_CHAINS: Record<string, string> = { bitcoin: 'Bitcoin', btc: 'Bitcoin', sui: 'Sui', aptos: 'Aptos', ton: 'TON', xrp: 'XRP' }

const ZERION_LINES: Record<Exclude<ZerionState, 'ok'>, string> = {
  off: 'EVM and Solana balances need a Zerion API key. The person can add their own in Ink’s Settings, under Wallet.',
  'bad-key': 'Zerion turned down the person’s API key, so EVM and Solana balances are missing. They can change it in Ink’s Settings.',
  'rate-limited': 'Zerion’s limit is used up for now, so EVM and Solana balances are missing. Try again in a minute.',
  unavailable: 'Zerion couldn’t be reached, so EVM and Solana balances are missing. Try again in a moment.',
}

const GROUP_NAMES: Record<HoldingGroup, string> = { near: 'NEAR', intents: 'NEAR Intents', evm: 'EVM', solana: 'Solana', tron: 'Tron' }

/**
 * get_portfolio's answer: NEAR, every token on every chain Ink reads with what it's worth,
 * and what isn't read, in words an agent can pass on. A chain filter names an account
 * (`near`, `evm`, `solana`, `tron`) or one chain (`base`).
 */
async function portfolioAnswer(read: McpHandlers['portfolio'], args: unknown): Promise<object> {
  const chain = isRecord(args) && typeof args.chain === 'string' ? args.chain.trim().toLowerCase() : ''
  const unreadChain = UNREAD_CHAINS[chain]
  if (unreadChain) return toolAnswer(`Ink can’t read ${unreadChain} balances yet.`)
  if (!read) return NOT_BUILT.get_portfolio ?? NOT_SET_UP
  let answer: PortfolioResult
  try {
    answer = await read()
  } catch {
    answer = { ok: false, reason: 'unavailable' }
  }
  if (!answer.ok) {
    if (answer.reason === 'no-vault') return NOT_SET_UP
    if (answer.reason === 'locked') return toolAnswer('Ink is locked. Ask the person to unlock Ink, then try again.', true)
    return toolAnswer('Ink couldn’t reach NEAR to read the balance. Try again in a moment.', true)
  }
  const { near, nearPrice, unpriced, totalUsd, gaps, zerion, unread } = answer
  const showNear = chain === '' || chain === 'near'
  const tokens = answer.tokens.filter((token) => chain === '' || token.group === chain || token.network === chain)
  // Zerion answers for every chain but NEAR, the Intents balance and Tron, which Ink reads itself.
  const zerionReads = chain === '' || (chain !== 'near' && chain !== 'intents' && chain !== 'tron')
  if (!showNear && tokens.length === 0) {
    if (chain === 'intents') return toolAnswer(gaps.includes('intents') ? GAP_LINES.intents : 'The NEAR Intents balance holds nothing with a price.')
    if (chain === 'tron') return toolAnswer(gaps.includes('tron') ? GAP_LINES.tron : 'The Tron account holds nothing with a price.')
    return toolAnswer(zerion === 'ok' ? `Nothing with a price was found on ${chain}.` : ZERION_LINES[zerion])
  }

  const inUsd = (amount: string) => (nearPrice ? ` (${dollars(Number(amount) * nearPrice.usd)})` : '')
  const pools = near.pools.map((pool) => `${pool.poolId}: ${pool.staked} NEAR${pool.unstaked !== '0' ? `, plus ${pool.unstaked} NEAR unstaked and waiting to be withdrawn` : ''}`)
  const nearLines = !showNear
    ? []
    : near.onChain
      ? [
          `NEAR account ${near.accountId}:`,
          `- Available to send: ${near.available} NEAR${inUsd(near.available)}`,
          `- Staked: ${near.staked} NEAR${inUsd(near.staked)}${pools.length > 0 ? ` (${pools.join('; ')})` : ''}`,
          `- Held for storage: ${near.storage} NEAR${inUsd(near.storage)}`,
          ...(near.stakingComplete ? [] : ['Some staking pools couldn’t be read, so the staked amount may be higher.']),
          ...(nearPrice ? [`NEAR is ${dollars(nearPrice.usd)}${change(nearPrice.change24h)}.`] : []),
        ]
      : [`NEAR account ${near.accountId} holds no NEAR yet. NEAR creates it with the first transfer into it, from any wallet or exchange.`]

  const reviewed = tokens.filter((token) => token.trust === 'reviewed')
  const unreviewed = tokens.filter((token) => token.trust === 'unreviewed')
  const thin = (token: TokenHolding) => (token.trust === 'reviewed' && token.countedUsd < token.usdValue * 0.95 ? `, counted as ${dollars(token.countedUsd)} since its market is too thin to sell this much near the price` : '')
  const where = (token: TokenHolding) => (token.group === 'intents' ? `in the NEAR Intents balance${token.origin ? `, from ${token.origin}` : ''}` : `on ${token.networkName}`)
  const which = (token: TokenHolding) => (!token.contract ? `${token.networkName}’s own coin` : token.group === 'intents' ? `token ${token.contract}` : `contract ${token.contract}`)
  const tokenLine = (token: TokenHolding) => `- ${token.amount} ${token.symbol} ${where(token)} (${dollars(token.usdValue)}${thin(token)}), ${which(token)}`
  const listed = (list: TokenHolding[]) => [...list.slice(0, MAX_TOKEN_LINES).map(tokenLine), ...(list.length > MAX_TOKEN_LINES ? [`- and ${list.length - MAX_TOKEN_LINES} more`] : [])]
  const lines = [
    ...nearLines,
    ...(reviewed.length > 0 ? ['Tokens:', ...listed(reviewed)] : []),
    ...(unreviewed.length > 0 ? ['Tokens nobody vouches for. They aren’t counted, and may be worth nothing or be fakes of real tokens:', ...listed(unreviewed)] : []),
    ...(chain === '' && unpriced > 0 ? [`${unpriced === 1 ? '1 more token has' : `${unpriced} more tokens have`} no price or ${unpriced === 1 ? 'is' : 'are'} marked as spam, so ${unpriced === 1 ? 'it isn’t' : 'they aren’t'} listed.`] : []),
    ...(chain === '' && totalUsd !== null
      ? [`Total: ${dollars(totalUsd)}, counting NEAR (staked and storage included) and the tokens above. Prices from Intear${zerion === 'ok' ? ' and Zerion' : ''}.`]
      : []),
    ...(showNear ? gaps.map((gap) => GAP_LINES[gap]) : (chain === 'intents' || chain === 'tron') && gaps.includes(chain) ? [GAP_LINES[chain]] : []),
    ...(zerionReads && zerion !== 'ok' ? [ZERION_LINES[zerion]] : []),
    ...(zerionReads && unread.length > 0 ? [`Zerion couldn’t read the ${unread.map((group) => GROUP_NAMES[group]).join(' or ')} account, so it’s missing.`] : []),
    ...(chain === '' ? ['Bitcoin, Sui and Aptos balances aren’t read yet.'] : []),
  ]
  return toolAnswer(lines.join('\n'))
}

const QUOTE_FIELDS = ['from_asset', 'from_chain', 'to_asset', 'to_chain', 'amount']

/** What get_quote's arguments ask for, or null if they break its schema. Each is one word, as create_plan's are. */
function quoteAskFrom(args: unknown): RouteAsk | null {
  if (!isRecord(args)) return null
  const fits = ([key, value]: [string, unknown]) => QUOTE_FIELDS.includes(key) && typeof value === 'string' && value.length <= MAX_PLAN_FIELD_CHARS && PLAN_FIELD.test(value)
  if (!Object.entries(args).every(fits)) return null
  const { from_asset: fromAsset, from_chain: fromChain, to_asset: toAsset, to_chain: toChain, amount } = args as Record<string, string | undefined>
  if (!fromAsset || !toAsset || !amount) return null
  return { fromAsset, toAsset, amount, ...(fromChain ? { fromChain } : {}), ...(toChain ? { toChain } : {}) }
}

const QUOTE_HELP = 'get_quote needs from_asset, to_asset and amount, each one word: an amount such as 5 or 0.25 in whole tokens, and chains such as near, base, ethereum, solana, bitcoin or intents.'

const UNCHECKED = 'Ink couldn’t read the balances just now, so it hasn’t checked the wallet can cover this.'
const amountText = ({ amount, symbol }: QuoteAmount) => `${amount} ${symbol}`
const onChain = ({ chain }: QuoteAmount) => (chain === 'near' ? 'on NEAR' : `on ${chainName(chain)}`)
const inUsd = (usd: number | null) => (usd === null ? '' : ` (${dollars(usd)})`)

/** get_quote's answer: the route, why, what goes in and comes out, the fees and the wait, in words an agent can pass on. */
async function quoteAnswer(quote: McpHandlers['quote'], args: unknown): Promise<object> {
  if (!quote) return NOT_BUILT.get_quote ?? NOT_SET_UP
  const ask = quoteAskFrom(args)
  if (!ask) return toolAnswer(QUOTE_HELP, true)
  let outcome: QuoteOutcome
  try {
    outcome = await quote(ask)
  } catch {
    return toolAnswer('Ink couldn’t get a quote right now. Try again.', true)
  }
  if (!outcome.ok) {
    switch (outcome.reason) {
      case 'no-vault':
        return NOT_SET_UP
      case 'locked':
        return toolAnswer('Ink is locked. Ask the person to unlock Ink, then try again.', true)
      case 'tokens-unavailable':
        return toolAnswer('Ink couldn’t reach NEAR Intents for its list of tokens. Try again in a moment.', true)
      case 'unknown-chain':
        return toolAnswer(`NEAR Intents doesn’t reach a chain called ${outcome.name}. Use a name such as near, base, ethereum, arbitrum, solana, bitcoin or intents.`, true)
      case 'unknown-asset':
        return toolAnswer(`NEAR Intents doesn’t list ${outcome.name}${outcome.chain ? ` ${outcome.chain === 'intents' ? 'in the Intents balance' : `on ${chainName(outcome.chain)}`}` : ''}. Check the symbol, or name the chain it’s on.`, true)
      case 'ambiguous-asset':
        return toolAnswer(`More than one token called ${outcome.name} is listed on ${chainName(outcome.chain)}, so Ink won’t guess. Ask the person for the token’s contract address.`, true)
      case 'bad-amount':
        return toolAnswer('The amount must be a plain decimal above zero in whole tokens, with no more decimal places than the token has.', true)
      case 'cannot-sign':
        return toolAnswer(`Ink can’t sign on ${chainName(outcome.chain)} yet, so it can’t pay from the wallet there. If the funds are moved into the NEAR Intents balance, Ink can pay from that.`, true)
      case 'direct-not-built':
        return toolAnswer(`Sending a token as it is on ${chainName(outcome.chain)} isn’t built yet. Ink can send native NEAR, and swap or bridge through NEAR Intents.`, true)
      case 'too-small':
        return toolAnswer('NEAR Intents says the amount is under its minimum for this swap. Try a larger amount.', true)
      case 'bad-recipient':
        return toolAnswer(`NEAR Intents won’t pay the wallet’s address on ${chainName(outcome.chain)}.`, true)
      case 'no-route':
        return toolAnswer('No market maker on NEAR Intents would quote this right now. Try another amount or token, or try again soon.', true)
      case 'mismatch':
        return toolAnswer('NEAR Intents answered for a different swap, so Ink didn’t use it. Try again.', true)
      default:
        return toolAnswer('Ink couldn’t reach NEAR Intents for a quote. Try again in a moment.', true)
    }
  }

  const moves = 'This quote moves nothing, and prices change; the plan gets a fresh one.'
  if (outcome.kind === 'direct') {
    return toolAnswer(
      [
        'Route: a direct transfer on NEAR. Nothing is swapped.',
        `- Sends: ${amountText(outcome.send)}`,
        `- Network fee: ${outcome.fee === null ? 'NEAR couldn’t say right now, usually well under 0.01 NEAR' : `at most ${outcome.fee} NEAR`}`,
        outcome.enough === null
          ? UNCHECKED
          : outcome.enough
            ? `The wallet has ${amountText(outcome.held)} available.`
            : `The wallet has only ${amountText(outcome.held)} available, so it can’t send this and pay the fee.`,
        moves,
      ].join('\n'),
    )
  }

  const from = outcome.source === 'wallet' ? `the wallet’s NEAR account${outcome.send.symbol === 'NEAR' ? ', wrapped to wNEAR first' : ''}` : 'the NEAR Intents balance'
  const changes = outcome.send.chain !== outcome.get.chain ? 'It changes chain' : 'It changes token'
  const why =
    outcome.source === 'intents'
      ? `The NEAR Intents balance holds it, so the NEAR key pays from there${outcome.signsOrigin ? '' : `, though Ink can’t sign on ${chainName(outcome.send.chain)} itself`}.`
      : `${changes}, which NEAR Intents does in one step from the NEAR account.`
  const paidTo =
    outcome.paidTo === 'own-address'
      ? `the wallet’s own address ${onChain(outcome.get)}`
      : outcome.paidTo === 'intents'
        ? 'the NEAR Intents balance, as asked'
        : `the NEAR Intents balance: Ink has no address of its own ${onChain(outcome.get)}, so a payout there needs an address the person types, and costs a little more`
  const fees = [
    ...(outcome.feeBps > 0 ? [`NEAR Intents’ ${(outcome.feeBps / 100).toFixed(2).replace(/\.?0+$/, '')}% fee`] : []),
    ...(outcome.withdrawFee ? [`${amountText(outcome.withdrawFee)} for sending it ${onChain(outcome.withdrawFee)}`] : []),
  ]
  return toolAnswer(
    [
      `Route: through NEAR Intents, paid from ${from}.`,
      `Why: ${why}`,
      `- Sends: ${amountText(outcome.send)} ${onChain(outcome.send)}${inUsd(outcome.send.usd)}`,
      `- Gets about: ${amountText(outcome.get)} ${onChain(outcome.get)}${inUsd(outcome.get.usd)}`,
      `- At least: ${amountText(outcome.least)}, or it’s refunded to the wallet’s NEAR account`,
      ...(fees.length > 0 ? [`- Fees already taken out: ${fees.join(' and ')}`] : []),
      `- Time: about ${outcome.seconds < 90 ? `${Math.max(1, Math.round(outcome.seconds))} seconds` : `${Math.round(outcome.seconds / 60)} minutes`} once the deposit lands`,
      `- Paid to: ${paidTo}`,
      ...(outcome.compared ? ['Ink quoted paying from the wallet and from the Intents balance, and this one gives more.'] : []),
      ...(outcome.enough === null ? [UNCHECKED] : outcome.enough ? [] : [`${outcome.source === 'wallet' ? 'The wallet' : 'The Intents balance'} holds only ${amountText(outcome.held)}, so it can’t pay this yet.`]),
      moves,
      outcome.source === 'wallet' && outcome.send.symbol === 'NEAR' && outcome.paidTo !== 'no-own-address'
        ? 'create_plan with outcome swap makes this a plan for the person to review, with a fresh quote.'
        : 'Ink can’t send this swap yet, so a plan for it stays a draft.',
    ].join('\n'),
  )
}

async function accountsAnswer(read: McpHandlers['accounts']): Promise<object> {
  if (!read) return NOT_SET_UP
  let answer: VaultResult<{ accounts: Account[] }>
  try {
    answer = await read()
  } catch {
    return toolAnswer('Ink couldn’t read the addresses right now. Try again.', true)
  }
  if (answer.ok) {
    const lines = answer.accounts.map(({ chain, address }) => `${chain}: ${address} (${CHAIN_LABELS[chain]})`)
    return toolAnswer(['The wallet’s own addresses, one for each chain. They are public.', ...lines].join('\n'))
  }
  if (answer.reason === 'no-vault') return NOT_SET_UP
  if (answer.reason === 'locked') return toolAnswer('Ink is locked. Ask the person to unlock Ink, then try again.', true)
  return toolAnswer('Ink couldn’t read the addresses right now. Try again.', true)
}

/** Longer than any asset, amount or address. */
const MAX_PLAN_FIELD_CHARS = 256

/**
 * One word of visible ASCII. A card shows an agent's values as written, so spaces and
 * line breaks could make one field read as a whole other instruction, and other
 * characters could reorder an address (U+202E), look like a gap in one (U+2800) or
 * pass for a letter in one (Cyrillic а). Addresses and asset symbols don't need them.
 */
const PLAN_FIELD = /^[!-~]+$/

const PLAN_FIELDS = ['outcome', 'asset', 'chain', 'amount', 'to', 'to_asset', 'to_chain']
const PLAN_OUTCOMES = ['send', 'swap', 'stake'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** What create_plan's arguments ask for, or null if they break its schema. The store checks it all again. */
function intentFrom(args: unknown): PlanIntent | null {
  if (!isRecord(args)) return null
  const entries = Object.entries(args)
  const fits = ([key, value]: [string, unknown]) =>
    PLAN_FIELDS.includes(key) && typeof value === 'string' && value.length <= MAX_PLAN_FIELD_CHARS && PLAN_FIELD.test(value)
  if (!entries.every(fits)) return null
  const field = (key: string) => (typeof args[key] === 'string' ? args[key] : null)
  const outcome = PLAN_OUTCOMES.find((known) => known === args.outcome)
  const asset = field('asset')
  const amount = field('amount')
  if (!outcome || !asset || !amount) return null
  // "Send 1 NEAR" with nobody to send it to would still read as a whole plan.
  if ((outcome === 'send' && !field('to')) || (outcome === 'swap' && !field('to_asset'))) return null
  return { outcome, asset, amount, chain: field('chain'), to: field('to'), toAsset: field('to_asset'), toChain: field('to_chain') }
}

export type RpcId = string | number | null

export function rpcError(id: RpcId, code: number, message: string): object {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

/** A line that wasn't JSON. */
export function parseErrorResponse(): object {
  return rpcError(null, PARSE_ERROR, 'Not JSON')
}

/**
 * Answers one JSON-RPC message from an agent, or returns null for a notification.
 * The agent is untrusted, so nothing about the message is assumed. A method this
 * server doesn't have gets a proper error rather than silence: Claude Code opens
 * with `server/discover` and falls back to `initialize` only when told no.
 */
export async function handleMcpMessage(message: unknown, version: string, { onPlan, accounts, plans, portfolio, quote }: McpHandlers = {}): Promise<object | null> {
  if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    const id = isRecord(message) && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null
    return rpcError(id, INVALID_REQUEST, 'Not a JSON-RPC 2.0 request')
  }
  if (!('id' in message)) return null
  const { id, method, params } = message
  if (typeof id !== 'string' && typeof id !== 'number') return rpcError(null, INVALID_REQUEST, 'Bad id')

  const result = (value: object) => ({ jsonrpc: '2.0', id, result: value })

  switch (method) {
    case 'initialize': {
      const asked = isRecord(params) ? params.protocolVersion : undefined
      return result({
        protocolVersion: typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: MCP_SERVER_NAME, version },
      })
    }
    case 'ping':
      return result({})
    case 'tools/list':
      return result({ tools: TOOLS })
    case 'tools/call': {
      if (!isRecord(params) || !TOOLS.some((tool) => tool.name === params.name)) {
        return rpcError(id, INVALID_PARAMS, 'Unknown tool')
      }
      if (params.arguments !== undefined && !isRecord(params.arguments)) {
        return rpcError(id, INVALID_PARAMS, 'Arguments must be an object')
      }
      if (params.name === 'create_plan') {
        const intent = intentFrom(params.arguments)
        if (!intent) return result(toolAnswer(PLAN_SCHEMA_HELP, true))
        if (!plans) return result(NOT_BUILT.create_plan ?? NOT_SET_UP)
        const made = await planAnswer(() => plans.create(intent), null, (plan) => `Plan ${plan.id} is made: ${plan.summary}. If Ink can send it (so far, NEAR sent on NEAR, and NEAR swapped through NEAR Intents to the person’s own address), Ink shows it to the person in its review window, and nothing is signed unless they approve it there. Anything else stays a draft. Call get_plan to see what became of it.`)
        if (made.plan) onPlan?.(chatPlanOf(made.plan))
        return result(made.answer)
      }
      if ((params.name === 'get_plan' || params.name === 'cancel_plan') && plans) {
        const id = planIdFrom(params.arguments)
        if (!id) return result(toolAnswer('plan_id must be the id create_plan gave.', true))
        const answered =
          params.name === 'get_plan'
            ? await planAnswer(() => plans.get(id), id, (plan) => `Plan ${plan.id} is ${STATUS_WORDS[plan.status]}: ${plan.summary}.${plan.swap ? ` ${SWAP_WORDS[plan.swap.stage](plan.swap)}` : ''}`)
            : await planAnswer(() => plans.cancel(id), id, (plan) => `Plan ${plan.id} is cancelled. Nothing was signed.`)
        return result(answered.answer)
      }
      if (params.name === 'get_accounts') return result(await accountsAnswer(accounts))
      if (params.name === 'get_portfolio') return result(await portfolioAnswer(portfolio, params.arguments))
      if (params.name === 'get_quote') return result(await quoteAnswer(quote, params.arguments))
      return result(NOT_BUILT[params.name as string] ?? NOT_SET_UP)
    }
    default:
      return rpcError(id, METHOD_NOT_FOUND, 'No such method')
  }
}
