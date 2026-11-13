import type { ChatSwap } from './ipc'

/** What a plan is and the states it moves through. Types and vocabulary only: main builds and hashes plans. */

/**
 * Every status a plan can be in. Main, the agent's tools and the page all use
 * this one list, so none can have its own idea of what a status means.
 */
export const PLAN_STATUSES = [
  /** Made, not yet ready to show the person. */
  'draft',
  /** Shown for review, waiting on the person. */
  'awaiting_review',
  /** The person said yes to these exact bytes. */
  'approved',
  /** The signer has it. */
  'signing',
  /** Sent to the chain. From here only the chain decides. */
  'submitted',
  'confirmed',
  'failed',
  'cancelled',
  /** Nobody acted on it in time. */
  'expired',
  /** A safety rule refused it. */
  'blocked',
] as const

export type PlanStatus = (typeof PLAN_STATUSES)[number]

export type PlanOutcome = 'send' | 'swap' | 'stake'

/** Who asked for the plan. Main sets this, never the caller. */
export type PlanCreator = 'agent' | 'ui'

/** What was asked for, in the asker's terms: names of assets and chains, and a decimal amount. */
export interface PlanIntent {
  outcome: PlanOutcome
  asset: string
  /** A plain decimal, as a string: `1`, `0.25`. Never a number, so it can't round. */
  amount: string
  chain: string | null
  to: string | null
  toAsset: string | null
  toChain: string | null
}

/**
 * Who gets paid, and why that address is allowed: it's the person's own on the
 * chain the funds land on, or it was sent from the chat's box ("typed"), where
 * the agent can't write. An agent can never supply one on its own. "Typed" keeps
 * the agent out, not compromised page code: the review window confirms it.
 */
export interface PlanRecipient {
  address: string
  why: 'own' | 'typed'
}

/**
 * One thing to sign. Chain modules fill these in with the exact unsigned fields:
 * integers as decimal strings and bytes as lowercase hex, so every value is a
 * string and nothing can round on its way to the hash.
 */
export interface PlanStep {
  chain: string
  action: string
  fields: Record<string, string>
}

/**
 * A swap through NEAR Intents' 1Click, as fixed when the plan was made from a binding
 * quote. Every value is a string, so the plan hash covers it exactly. The steps pay the
 * deposit address; these say what 1Click promised for it.
 */
export interface PlanSwap {
  via: '1click'
  depositAddress: string
  /** ISO 8601. After this the deposit address is dead, and nothing may be sent to it. */
  deadline: string
  originAsset: string
  destinationAsset: string
  /** In each token's smallest unit. */
  amountIn: string
  amountOut: string
  /** The least the swap pays out, or it's refunded. */
  minAmountOut: string
  sendSymbol: string
  getSymbol: string
  getDecimals: string
  /** 1Click's name for the chain it pays out on: `base`, `sol`, or `intents` for the Intents balance. */
  getChain: string
  /** Who 1Click pays: the person's own address there, or one they typed. */
  recipient: string
  /** Where a refund goes: the person's own NEAR account. */
  refundTo: string
  /** 1Click's own fee, in basis points, already out of amountOut. */
  feeBps: string
  /** How long 1Click expects the swap to take once the deposit lands. */
  seconds: string
}

/**
 * The part of a plan that is hashed, and so can never change once made. Status
 * and anything learned about the plan later live outside it.
 */
export interface PlanCore {
  /** Bumped only if what's hashed, or how, changes. */
  hashVersion: 1
  id: string
  createdBy: PlanCreator
  /** ISO 8601, set by main. */
  createdAt: string
  /** After this the plan reads as expired, whether or not anything wrote that down. */
  expiresAt: string
  intent: PlanIntent
  recipient: PlanRecipient | null
  /** What the person reads, written by main, never by the agent. Hashed so it can't change under the steps. */
  summary: string
  steps: PlanStep[]
  /** A swap's terms, when the plan is one. Absent from every other plan. */
  swap?: PlanSwap
}

export type PlanFailure =
  /** The request isn't a plan Ink can make: a bad amount or a missing or malformed field. */
  | 'bad-request'
  /** It would pay an address that is neither the person's own nor one they typed. */
  | 'recipient-not-allowed'
  /** Too many plans too quickly, or too many kept at once. */
  | 'too-many'
  /** No plan with that id belongs to whoever asked. */
  | 'not-found'
  /** The plan's status doesn't allow that move. */
  | 'cannot-move'
  /** The account can't cover the amount and the most the fee could be. */
  | 'insufficient-funds'
  /** The recipient is a named account that doesn't exist, so nothing could arrive. */
  | 'recipient-unknown'
  /** The chain couldn't be reached to build the plan. */
  | 'chain-unavailable'
  /** NEAR Intents wouldn't quote the swap: under its minimum, or no market maker answered. */
  | 'no-route'
  /** The payout address isn't a valid address on the chain it lands on, or one Ink can check yet. */
  | 'bad-address'

/** What an agent's chat learns about one of its plans. */
export interface PlanSummary {
  id: string
  status: PlanStatus
  summary: string
  intent: PlanIntent
  recipient: PlanRecipient | null
  /** Where its swap stands, once a swap's deposit landed. */
  swap?: ChatSwap
}

export type PlanToolResult =
  | { ok: true; plan: PlanSummary }
  | { ok: false; reason: PlanFailure | 'locked' | 'no-vault' | 'unavailable'; status?: PlanStatus }

/**
 * What an agent's chat can do with plans, with main deciding everything that
 * matters: who made the plan, whose addresses count, and what the person typed.
 */
export interface PlanTools {
  create(intent: PlanIntent): Promise<PlanToolResult>
  get(id: string): Promise<PlanToolResult>
  cancel(id: string): Promise<PlanToolResult>
}
