import { randomUUID } from 'node:crypto'
import type { Account } from '../../shared/accounts'
import { PLAN_STATUSES, type PlanCore, type PlanCreator, type PlanFailure, type PlanIntent, type PlanStatus } from '../../shared/plan'
import { PlanIntegrityError } from './canonical'
import { planHash } from './hash'
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
}

export interface PlanStoreOptions {
  now?: () => Date
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
  return `Stake ${amount} ${asset}${on(chain)}${to ? ` with ${to}` : ''}`
}

const goodAmount = (amount: string) => amount.length <= MAX_AMOUNT_CHARS && AMOUNT.test(amount) && /[1-9]/.test(amount)

/**
 * Plans, kept in memory while the app runs. A plan's core is fixed and frozen
 * the moment it's made, and its hash is checked again whenever it's read back.
 * Its status is kept beside the core, outside the hash, and only moves the way
 * the status table allows.
 */
export function createPlanStore({ now = () => new Date(), newId = randomUUID }: PlanStoreOptions = {}) {
  const plans = new Map<string, Entry>()
  /** When each owner last made plans, for the per-minute limit. */
  const madeAt = new Map<string, number[]>()

  const view = (id: string, entry: Entry): PlanView => {
    // The core is frozen, so this can't fail unless something is badly wrong; if it does, nothing may use the plan.
    if (planHash(entry.core) !== entry.hash) throw new PlanIntegrityError(`plan ${id} no longer matches its hash`)
    return { id, hash: entry.hash, status: effectiveStatus(entry.status, entry.core.expiresAt, now()), core: entry.core }
  }

  /** Makes room by dropping finished plans, oldest first. False when every plan is still live. */
  const makeRoom = (): boolean => {
    if (plans.size < MAX_PLANS) return true
    for (const [id, entry] of plans) {
      if (isFinal(effectiveStatus(entry.status, entry.core.expiresAt, now()))) {
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
    create({ intent, createdBy, owner, own, typed }: NewPlan): PlanResult<{ plan: PlanView }> {
      const words = [intent.asset, intent.chain, intent.to, intent.toAsset, intent.toChain].filter((field) => field !== null)
      if (!goodAmount(intent.amount) || !intent.asset || !words.every((word) => WORD.test(word))) return { ok: false, reason: 'bad-request' }
      if (intent.outcome === 'send' && !intent.to) return { ok: false, reason: 'bad-request' }
      if (intent.outcome === 'swap' && !intent.toAsset) return { ok: false, reason: 'bad-request' }
      // Whatever the outcome, an address in the plan must be the person's own or one they typed.
      const recipient = intent.to ? allowedRecipient(intent.to, own, typed) : null
      if (intent.to && !recipient) return { ok: false, reason: 'recipient-not-allowed' }

      const at = now()
      const recent = (madeAt.get(owner) ?? []).filter((time) => at.getTime() - time < 60_000)
      if (recent.length >= PLANS_PER_MINUTE || !makeRoom()) return { ok: false, reason: 'too-many' }
      madeAt.set(owner, [...recent, at.getTime()])

      const core: PlanCore = deepFreeze({
        hashVersion: 1,
        id: newId(),
        createdBy,
        createdAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + PLAN_TTL_MS).toISOString(),
        intent: { ...intent },
        recipient,
        summary: summaryOf(intent),
        // Chain modules add the exact unsigned fields; until they do, a plan is a draft.
        steps: [],
      })
      const entry: Entry = { core, hash: planHash(core), owner, status: 'draft' }
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
