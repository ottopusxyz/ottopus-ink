import { randomUUID } from 'node:crypto'
import type { Account, AccountChain } from '../../shared/accounts'
import { PLAN_STATUSES, type PlanCore, type PlanCreator, type PlanFailure, type PlanIntent, type PlanStatus, type PlanStep, type PlanSwap } from '../../shared/plan'
import { PlanIntegrityError } from '../../shared/canonical'
import { planHash } from '../../shared/plan-hash'
import { allowedRecipient } from './recipients'
import { canTransition, effectiveStatus, isFinal } from './status'

/** How long a plan waits for the person before it reads as expired. */
export const PLAN_TTL_MS = 30 * 60_000
/** New plans one chat may make in a minute, so an agent in a loop can't bury the person in them. */
export const PLANS_PER_MINUTE = 5
/** Plans kept in memory at once. Finished ones make way first. */
export const MAX_PLANS = 500

/** A plain decimal greater than zero, as a string, with no sign, exponent or leading zeros. */
const AMOUNT = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/
/** Longer than any real amount: 78 digits is past 2^256. */
const MAX_AMOUNT_CHARS = 79

/**
 * One word of visible ASCII, the same rule the agent's tool applies. Checked here
 * too, since the store is also what the review window and Send button will call:
 * a summary built from fields with spaces, line breaks or lookalike letters could
 * read as something else.
 */
const WORD = /^[!-~]{1,256}$/

export type PlanResult<T = object> = ({ ok: true } & T) | { ok: false; reason: PlanFailure; status?: PlanStatus }

/** A plan as anyone outside the store sees it: its fixed core, its hash, and its status right now. */
export interface PlanView {
  id: string
  hash: string
  status: PlanStatus
  core: PlanCore
}

export interface NewPlan {
  intent: PlanIntent
  createdBy: PlanCreator
  /** Who may see and cancel it: the chat's session for an agent's plan. */
  owner: string
  /** The person's own addresses. */
  own: readonly Account[]
  /** The person's own messages in that chat, as main captured them, never the agent's. */
  typed: readonly string[]
}

interface Entry {
  core: PlanCore
  hash: string
  owner: string
  status: PlanStatus
  /** When the plan expires on the monotonic clock, which a wall-clock correction can't move. */
  deadline: number
}

/**
 * Fills in a plan's steps from its checked intent: the chain module's exact
 * unsigned fields, or nothing when no module handles the intent yet, which
 * leaves the plan a draft. A failure means the plan can't go through.
 */
export type BuildSteps = (intent: PlanIntent, own: readonly Account[]) => Promise<{ ok: true; steps: PlanStep[] } & BuiltSwap | { ok: false; reason: PlanFailure }>

/**
 * What a swap's builder adds: the terms 1Click fixed, and who it pays, which must be the
 * address the person typed, or else their own on the chain it pays out on. The store checks that again.
 */
export interface BuiltSwap {
  swap?: PlanSwap
  /** A payment's legs, each paying part of it to the same address. */
  swaps?: PlanSwap[]
  payout?: { address: string; chain: AccountChain }
}

/** How long a swap's deposit address must outlive the plan, so a deposit sent at the last moment still lands in time. */
export const SWAP_DEADLINE_MARGIN_MS = 10 * 60_000

const NO_STEPS: BuildSteps = async () => ({ ok: true, steps: [] })

export interface PlanStoreOptions {
  /** The chain modules' step builders, behind one function. */
  buildSteps?: BuildSteps
  now?: () => Date
  /** Milliseconds that only ever go forward, for timing a plan's life whatever the wall clock does. */
  monotonic?: () => number
  newId?: () => string
}

/** Freezes every level, so nothing holding a core can change what was hashed. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

/** What the person reads. Written here from checked fields, never taken from the agent. */
function summaryOf({ outcome, asset, amount, chain, to, toAsset, toChain }: PlanIntent): string {
  const on = (name: string | null) => (name ? ` on ${name}` : '')
  if (outcome === 'send') return `Send ${amount} ${asset}${on(chain)} to ${to}`
  if (outcome === 'swap') return `Swap ${amount} ${asset}${on(chain)} to ${toAsset}${on(toChain)}`
  if (outcome === 'pay') return `Pay ${amount} ${asset}${on(toChain)}${to ? ` to ${to}` : ''}`
  return `Stake ${amount} ${asset}${on(chain)}${to ? ` with ${to}` : ''}`
}

const goodAmount = (amount: string) => amount.length <= MAX_AMOUNT_CHARS && AMOUNT.test(amount) && /[1-9]/.test(amount)

/**
 * Plans, kept in memory while the app runs. A plan's core is fixed and frozen
 * the moment it's made, and its hash is checked again whenever it's read back.
 * Its status is kept beside the core, outside the hash, and only moves the way
 * the status table allows.
 */
export function createPlanStore({ buildSteps = NO_STEPS, now = () => new Date(), monotonic = () => performance.now(), newId = randomUUID }: PlanStoreOptions = {}) {
  const plans = new Map<string, Entry>()
  /** When each owner last made plans, for the per-minute limit. */
  const madeAt = new Map<string, number[]>()

  /**
   * A plan's status right now. It expires when either clock says its time is up,
   * and once expired it's written down, so a wall clock set back later can't
   * bring it back to life.
   */
  const statusOf = (entry: Entry): PlanStatus => {
    const due = monotonic() >= entry.deadline && canTransition(entry.status, 'expired')
    if (due || effectiveStatus(entry.status, entry.core.expiresAt, now()) === 'expired') entry.status = 'expired'
    return entry.status
  }

  const view = (id: string, entry: Entry): PlanView => {
    // The core is frozen, so this can't fail unless something is badly wrong; if it does, nothing may use the plan.
    if (planHash(entry.core) !== entry.hash) throw new PlanIntegrityError(`plan ${id} no longer matches its hash`)
    return { id, hash: entry.hash, status: statusOf(entry), core: entry.core }
  }

  /** Makes room by dropping finished plans, oldest first. False when every plan is still live. */
  const makeRoom = (): boolean => {
    if (plans.size < MAX_PLANS) return true
    for (const [id, entry] of plans) {
      if (isFinal(statusOf(entry))) {
        plans.delete(id)
        return true
      }
    }
    return false
  }

  const owned = (id: string, owner: string): Entry | null => {
    const entry = plans.get(id)
    return entry && entry.owner === owner ? entry : null
  }

  return {
    /**
     * Makes a plan, if its intent is well formed, it pays only whom it may, the
     * owner isn't over the limit, and its chain module can build its steps. The
     * limit is counted before building, so a chat can't make Ink call a chain
     * more often than it may make plans.
     */
    async create({ intent, createdBy, owner, own, typed }: NewPlan): Promise<PlanResult<{ plan: PlanView }>> {
      const words = [intent.asset, intent.chain, intent.to, intent.toAsset, intent.toChain].filter((field) => field !== null)
      if (!goodAmount(intent.amount) || !intent.asset || !words.every((word) => WORD.test(word))) return { ok: false, reason: 'bad-request' }
      if (intent.outcome === 'send' && !intent.to) return { ok: false, reason: 'bad-request' }
      if (intent.outcome === 'swap' && !intent.toAsset) return { ok: false, reason: 'bad-request' }
      // Whatever the outcome, an address in the plan must be the person's own on the chain the funds land on, or one
      // they typed. A swap's funds land on its target chain, or on the same chain when it names none.
      if (intent.outcome === 'pay' && !intent.toChain) return { ok: false, reason: 'bad-request' }
      const landsOn = intent.outcome === 'swap' || intent.outcome === 'pay' ? (intent.toChain ?? intent.chain) : intent.chain
      const recipient = intent.to ? allowedRecipient(intent.to, landsOn, own, typed) : null
      if (intent.to && !recipient) return { ok: false, reason: 'recipient-not-allowed' }

      const tick = monotonic()
      const recent = (madeAt.get(owner) ?? []).filter((time) => tick - time < 60_000)
      if (recent.length >= PLANS_PER_MINUTE || !makeRoom()) return { ok: false, reason: 'too-many' }
      madeAt.set(owner, [...recent, tick])

      const built = await buildSteps({ ...intent }, own)
      if (!built.ok) return { ok: false, reason: built.reason }
      // Other plans may have filled the store while the steps were built.
      if (!makeRoom()) return { ok: false, reason: 'too-many' }

      const at = now()
      // A swap pays the address the person typed, or else their own there, and nothing else; and outlives the plan.
      let payee = recipient
      if (built.swap || built.swaps || built.payout) {
        const payout = built.payout
        const paid = !payout ? null : intent.to ? (payout.address === intent.to ? recipient : null) : allowedRecipient(payout.address, payout.chain, own, [])
        // A swap has one set of terms and a payment one for each leg; every one must pay the same allowed address.
        const terms = built.swaps ?? (built.swap ? [built.swap] : [])
        const fits = built.swaps ? intent.outcome === 'pay' && !built.swap : intent.outcome === 'swap'
        if (!fits || terms.length === 0 || !payout || !paid || (!intent.to && paid.why !== 'own') || terms.some((each) => each.recipient !== paid.address)) return { ok: false, reason: 'recipient-not-allowed' }
        if (terms.some((each) => !(Date.parse(each.deadline) >= at.getTime() + PLAN_TTL_MS + SWAP_DEADLINE_MARGIN_MS))) return { ok: false, reason: 'chain-unavailable' }
        payee = paid
      }

      const core: PlanCore = deepFreeze({
        hashVersion: 1,
        id: newId(),
        createdBy,
        createdAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + PLAN_TTL_MS).toISOString(),
        intent: { ...intent },
        recipient: payee,
        summary: summaryOf(intent),
        // Copied into plain objects, so only the strings the hash covers can be in them.
        steps: built.steps.map(({ chain, action, fields }) => ({ chain, action, fields: { ...fields } })),
        ...(built.swap ? { swap: { ...built.swap } } : {}),
        ...(built.swaps ? { swaps: built.swaps.map((each) => ({ ...each })) } : {}),
      })
      const entry: Entry = { core, hash: planHash(core), owner, status: 'draft', deadline: monotonic() + PLAN_TTL_MS }
      plans.set(core.id, entry)
      return { ok: true, plan: view(core.id, entry) }
    },

    get(id: string, owner: string): PlanView | null {
      const entry = owned(id, owner)
      return entry ? view(id, entry) : null
    },

    /** Moves a plan to a new status, if the status table allows it from where the plan is now. */
    move(id: string, owner: string, to: PlanStatus): PlanResult<{ plan: PlanView }> {
      const entry = owned(id, owner)
      if (!entry || !PLAN_STATUSES.includes(to)) return { ok: false, reason: 'not-found' }
      const current = view(id, entry).status
      if (!canTransition(current, to)) return { ok: false, reason: 'cannot-move', status: current }
      entry.status = to
      return { ok: true, plan: view(id, entry) }
    },
  }
}

export type PlanStore = ReturnType<typeof createPlanStore>
