import type { ChatPlan } from '../../../shared/ipc'

/** What a step's icon shows: a glyph for Ink's own steps, or the chain or token it lands on. */
export type TrackerIcon = { kind: 'review' } | { kind: 'sign' } | { kind: 'swap' } | { kind: 'chain'; chain: string } | { kind: 'token'; symbol: string; chain: string | null }

/** One step of a plan's way through Ink, as the tracker strip draws it. */
export interface TrackerStep {
  label: string
  icon: TrackerIcon
  /** A few words on where this step stands, when there's more to say than its label. */
  detail: string | null
  state: 'done' | 'active' | 'pending' | 'failed'
  /** An explorer page for this step, once there is one. Always https. */
  link: { label: string; url: string } | null
}

/** How far through review, signing and NEAR a plan's status is. */
const REACHED: Record<ChatPlan['status'], number> = {
  draft: 0,
  awaiting_review: 1,
  approved: 2,
  signing: 3,
  submitted: 4,
  confirmed: 5,
  failed: -1,
  cancelled: -1,
  expired: -1,
  blocked: -1,
}

const titled = (word: string) => word.slice(0, 1).toUpperCase() + word.slice(1)

/**
 * The steps of a plan, from review to NEAR and, for a swap, on through NEAR Intents to
 * its payout: what's done, what's under way, and what's still to come. Everything here
 * comes from main's events: the status, the NEAR transaction and the swap's progress.
 */
export function trackerSteps(plan: ChatPlan): TrackerStep[] {
  // Main's journey, when it sent one, is every step as main follows them: drawn as it is.
  if (plan.journey) return plan.journey.steps.map(({ label, icon, state, detail, link }) => ({ label, icon, state, detail, link }))
  return stepsOf(plan).map((step) => ({ ...step, icon: iconOf(step.label, plan) }))
}

/** Each step's icon: review and signing are Ink's own, NEAR runs the transaction, and a swap pays out its token on its chain. */
function iconOf(label: string, plan: ChatPlan): TrackerIcon {
  if (label === 'Review') return { kind: 'review' }
  if (label === 'Sign') return { kind: 'sign' }
  if (label === 'On NEAR') return { kind: 'chain', chain: 'near' }
  if (label === 'Swap') return { kind: 'swap' }
  return plan.toAsset ? { kind: 'token', symbol: plan.toAsset, chain: plan.toChain } : { kind: 'chain', chain: plan.toChain ?? 'near' }
}

type Step = Omit<TrackerStep, 'icon'>

function stepsOf(plan: ChatPlan): Step[] {
  const reached = REACHED[plan.status]
  const tx = plan.transactionId ? { label: 'nearblocks', url: `https://nearblocks.io/txns/${encodeURIComponent(plan.transactionId)}` } : null
  const step = (label: string, state: TrackerStep['state'], detail: string | null = null, link: TrackerStep['link'] = null): Step => ({ label, detail, state, link })

  // Stopped before anything was signed.
  if (plan.status === 'cancelled' || plan.status === 'expired' || plan.status === 'blocked' || plan.status === 'draft') {
    const why = { cancelled: 'Cancelled', expired: 'Expired', blocked: 'Blocked', draft: 'Ink can’t send this yet' }[plan.status]
    const first = step('Review', plan.status === 'draft' ? 'pending' : 'failed', why)
    return [first, step('Sign', 'pending'), step('On NEAR', 'pending'), ...(plan.outcome === 'swap' ? swapSteps(plan, 'pending') : [])]
  }

  const failedAt = plan.status === 'failed' ? (plan.transactionId ? 3 : 2) : null
  const review = step('Review', reached >= 2 || failedAt !== null ? 'done' : 'active', reached >= 2 || failedAt !== null ? 'Approved' : 'Waiting for you')
  const sign =
    failedAt === 2
      ? step('Sign', 'failed', 'Not sent')
      : step('Sign', reached >= 4 || failedAt === 3 ? 'done' : reached >= 2 ? 'active' : 'pending', reached >= 4 || failedAt === 3 ? 'Signed' : reached >= 2 ? 'Signing' : null)
  const near =
    failedAt === 3
      ? step('On NEAR', 'failed', 'NEAR didn’t run it', tx)
      : failedAt === 2
        ? step('On NEAR', 'pending')
        : step('On NEAR', reached >= 5 ? 'done' : reached === 4 ? 'active' : 'pending', reached >= 5 ? (plan.outcome === 'swap' ? 'Deposit confirmed' : 'Confirmed') : reached === 4 ? 'Waiting for NEAR' : null, tx)
  if (plan.outcome !== 'swap') return [review, sign, near]
  return [review, sign, near, ...swapSteps(plan, failedAt !== null ? 'pending' : reached >= 5 ? 'active' : 'pending')]
}

/** A swap's own steps once its deposit landed: NEAR Intents swapping it, then the payout. */
function swapSteps(plan: ChatPlan, from: TrackerStep['state']): Step[] {
  const where = plan.toChain ? `Paid out on ${titled(plan.toChain)}` : 'Paid out'
  const swap = plan.swap
  if (!swap || from === 'pending') {
    return [
      { label: 'Swap', detail: from === 'active' ? 'NEAR Intents picks it up' : null, state: from, link: null },
      { label: where, detail: null, state: 'pending', link: null },
    ]
  }
  const payout = swap.link ? { label: 'payout', url: swap.link } : null
  switch (swap.stage) {
    case 'deposited':
      return [
        { label: 'Swap', detail: 'NEAR Intents picks it up', state: 'active', link: null },
        { label: where, detail: null, state: 'pending', link: null },
      ]
    case 'swapping':
      return [
        { label: 'Swap', detail: 'Swapping now', state: 'active', link: null },
        { label: where, detail: null, state: 'pending', link: null },
      ]
    case 'done':
      return [
        { label: 'Swap', detail: 'Swapped', state: 'done', link: null },
        { label: where, detail: swap.got, state: 'done', link: payout },
      ]
    case 'refunded':
      return [
        { label: 'Swap', detail: 'Refunded', state: 'failed', link: null },
        { label: where, detail: swap.refunded ? `${swap.refunded} back to your NEAR account` : 'Back to your NEAR account', state: 'failed', link: null },
      ]
    case 'failed':
      return [
        { label: 'Swap', detail: 'Couldn’t finish', state: 'failed', link: null },
        { label: where, detail: 'Any refund goes to your NEAR account', state: 'failed', link: null },
      ]
    case 'unknown':
      return [
        { label: 'Swap', detail: 'Ink stopped checking', state: 'active', link: null },
        { label: where, detail: 'NEAR Intents pays out or refunds on its own', state: 'pending', link: null },
      ]
  }
}

/**
 * Whether a plan is still on its way: waiting for review, being signed or sent, or a swap
 * NEAR Intents hasn't settled yet. A finished plan's tracker steps aside: Ink's note in the
 * chat says how it ended. A draft Ink can't send isn't on its way either.
 */
export function isUnderWay(plan: ChatPlan): boolean {
  // A journey is under way until its last step is done or one failed: a payment's payout can land well after it's confirmed.
  if (plan.journey) return !plan.journey.done && !plan.journey.failed && plan.status !== 'draft'
  switch (plan.status) {
    case 'awaiting_review':
    case 'approved':
    case 'signing':
    case 'submitted':
      return true
    case 'confirmed':
      return plan.outcome === 'swap' && (!plan.swap || plan.swap.stage === 'deposited' || plan.swap.stage === 'swapping')
    default:
      return false
  }
}

/** Where a plan stands in a few words, for the strip's headline. */
export function trackerSummary(plan: ChatPlan): string {
  const steps = trackerSteps(plan)
  const failed = steps.find((s) => s.state === 'failed')
  if (failed) return failed.detail ?? failed.label
  const active = steps.find((s) => s.state === 'active')
  if (active) return active.detail ?? active.label
  if (steps.every((s) => s.state === 'done')) return plan.outcome === 'swap' || plan.outcome === 'pay' ? 'Done' : 'Sent'
  return steps[0]?.detail ?? 'Not started'
}
