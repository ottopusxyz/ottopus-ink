import { randomUUID } from 'node:crypto'
import type { ChatPlan } from '../../shared/ipc'

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

/** Every tool's answer until the wallet exists. */
const NOT_SET_UP = toolAnswer('The wallet is not set up yet.')

/** What the app hands the MCP server. Main passes these in, so this code never reaches the vault itself. */
export interface McpHandlers {
  /** Gets each plan the session's agent proposes. */
  onPlan?: (plan: ChatPlan) => void
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

/** A placeholder plan from create_plan's arguments, or null if they break its schema. */
function planFrom(args: unknown): ChatPlan | null {
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
  return {
    id: randomUUID(),
    status: 'draft',
    outcome,
    asset,
    amount,
    chain: field('chain'),
    to: field('to'),
    toAsset: field('to_asset'),
    toChain: field('to_chain'),
  }
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
export async function handleMcpMessage(message: unknown, version: string, { onPlan }: McpHandlers = {}): Promise<object | null> {
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
        const plan = planFrom(params.arguments)
        if (!plan) return result(toolAnswer('Those plan details do not match the schema. Each value must be one word of plain ASCII, a send needs to, and a swap needs to_asset.', true))
        onPlan?.(plan)
        return result(toolAnswer(`Plan ${plan.id} is a placeholder. The wallet is not set up yet, so it can't be reviewed or signed.`))
      }
      return result(NOT_SET_UP)
    }
    default:
      return rpcError(id, METHOD_NOT_FOUND, 'No such method')
  }
}
