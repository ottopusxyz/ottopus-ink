import type { Account, AccountChain } from '../../shared/accounts'
import type { ChatPlan } from '../../shared/ipc'
import type { PlanIntent, PlanStatus, PlanSummary, PlanToolResult, PlanTools } from '../../shared/plan'
import type { VaultResult } from '../../shared/vault'

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
    description: 'What the wallet holds, optionally on one chain.',
    inputSchema: objectSchema({ chain: text }),
  },
  {
    name: 'get_quote',
    description: 'What a swap or bridge would give right now. Moves nothing.',
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
export async function handleMcpMessage(message: unknown, version: string, { onPlan, accounts, plans }: McpHandlers = {}): Promise<object | null> {
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
        const made = await planAnswer(() => plans.create(intent), null, (plan) => `Plan ${plan.id} is a draft: ${plan.summary}. Ink can’t review or sign plans yet.`)
        if (made.plan) onPlan?.(chatPlanOf(made.plan))
        return result(made.answer)
      }
      if ((params.name === 'get_plan' || params.name === 'cancel_plan') && plans) {
        const id = planIdFrom(params.arguments)
        if (!id) return result(toolAnswer('plan_id must be the id create_plan gave.', true))
        const answered =
          params.name === 'get_plan'
            ? await planAnswer(() => plans.get(id), id, (plan) => `Plan ${plan.id} is ${STATUS_WORDS[plan.status]}: ${plan.summary}.`)
            : await planAnswer(() => plans.cancel(id), id, (plan) => `Plan ${plan.id} is cancelled. Nothing was signed.`)
        return result(answered.answer)
      }
      if (params.name === 'get_accounts') return result(await accountsAnswer(accounts))
      return result(NOT_BUILT[params.name as string] ?? NOT_SET_UP)
    }
    default:
      return rpcError(id, METHOD_NOT_FOUND, 'No such method')
  }
}
