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
 * Who gets paid, and why that address is allowed: it's one of the person's own,
 * or the person typed it themselves. An agent can never supply one on its own.
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
}
