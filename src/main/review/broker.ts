import type { PlanStatus } from '../../shared/plan'
import type { ReviewFailure, ReviewPlan, ReviewState } from '../../shared/review'
import type { PlanStore, PlanView } from '../plans/store'
import { isFinal } from '../plans/status'
import type { PlanSender, SendFailure } from '../vault/send-plan'

/**
 * How long the review window must be up and in front before Approve works. A
 * window that pops up under a click or a key press meant for something else
 * can't be approved by it.
 */
export const ARM_DELAY_MS = 1_500
/** How recent the real click or key press behind an approval must be. It arrives within milliseconds of the click. */
export const GESTURE_WINDOW_MS = 1_000

export type ApproveResult = { ok: true } | { ok: false; reason: ReviewFailure }

export interface ReviewBrokerOptions {
  store: PlanStore
  sender: Pick<PlanSender, 'send'>
  /** What the window shows for a plan, or null for a plan Ink can't send, which then stays a draft. */
  describe: (plan: PlanView) => Promise<ReviewPlan | null>
  unlocked: () => boolean
  /** Gets the state whenever it changes. Null means nothing is left to review. */
  onState: (state: ReviewState | null) => void
  /** Milliseconds that only ever go forward. */
  monotonic?: () => number
}

interface Offer {
  id: string
  owner: string
  plan: ReviewPlan
  /** Told each new status the plan reaches while the broker holds it, for the chat's plan card. */
  notify: (status: PlanStatus) => void
  status: PlanStatus
  failure: ReviewFailure | null
  transactionId: string | null
}

/** Reasons a send can stop for that the window explains. Anything else reads as a refusal. */
const SEND_FAILURES: ReadonlySet<string> = new Set<ReviewFailure>([
  'locked',
  'busy',
  'cannot-move',
  'wrong-network',
  'chain-unavailable',
  'insufficient-funds',
  'recipient-unknown',
  'earlier-pending',
  'plan-mismatch',
  'refused',
  'signer-stopped',
  'not-found',
  'bad-request',
])

const reviewFailureOf = (reason: SendFailure): ReviewFailure => (SEND_FAILURES.has(reason) ? (reason as ReviewFailure) : 'refused')

/** Statuses the person can still approve or reject from. */
const OPEN: ReadonlySet<PlanStatus> = new Set(['awaiting_review', 'approved'])

/**
 * The approval broker: the only way a plan is approved. Plans a locked chat made
 * wait their turn, one shown at a time. Approve counts only:
 * - for the plan and hash on show;
 * - once the window has been up and in front for ARM_DELAY_MS;
 * - with a real click or key press in the window since then, which the window
 *   reports from Electron's own input events, out of the page's reach.
 * Each such input approves once. Ink must be unlocked, and the plan still open.
 *
 * Reject cancels the plan and nothing is signed. Expiry needs nothing from the
 * broker: the store reads a plan past its time as expired, and the window shows
 * that on its next refresh.
 */
export function createReviewBroker({ store, sender, describe, unlocked, onState, monotonic = () => performance.now() }: ReviewBrokerOptions) {
  const queue: Offer[] = []
  /** When the current plan came up, or the window last took focus. */
  let shownAt = -Infinity
  /** The last real click or key press in the window. */
  let inputAt = -Infinity
  let sending = false
  let last = ''

  const current = (): Offer | null => queue[0] ?? null
  const armed = () => monotonic() >= shownAt + ARM_DELAY_MS

  /** Reads the plan's status, and tells its chat if it moved. A plan the store let go of keeps the last status read. */
  const sync = (offer: Offer): PlanStatus => {
    const status = store.get(offer.id, offer.owner)?.status ?? offer.status
    if (status !== offer.status) {
      offer.status = status
      offer.notify(status)
    }
    return status
  }

  const state = (): ReviewState | null => {
    const offer = current()
    if (!offer) return null
    return {
      plan: offer.plan,
      status: offer.status,
      armed: armed(),
      unlocked: unlocked(),
      sending,
      failure: offer.failure,
      transactionId: offer.transactionId,
      waiting: queue.length - 1,
    }
  }

  /** Input from before this never counts: an approval needs input after the window armed. */
  const shown = () => {
    shownAt = monotonic()
  }

  /** Brings every plan up to date, drops waiting ones that finished before their turn, and sends the state if it changed. */
  const refresh = () => {
    for (const offer of queue) sync(offer)
    for (let i = queue.length - 1; i >= 1; i--) {
      if (isFinal(queue[i]!.status)) queue.splice(i, 1)
    }
    const next = state()
    const key = JSON.stringify(next)
    if (key === last) return
    last = key
    onState(next)
  }

  /** Moves on from the plan shown. */
  const next = () => {
    queue.shift()
    if (queue.length > 0) shown()
    refresh()
  }

  const refuse = (reason: ReviewFailure): ApproveResult => ({ ok: false, reason })

  /** Cancels the plan shown and moves on. Nothing is signed. */
  const reject = (id: string): void => {
    const offer = current()
    if (!offer || offer.id !== id || sending) return
    if (OPEN.has(sync(offer))) store.move(id, offer.owner, 'cancelled')
    sync(offer)
    next()
  }

  /** Done with the plan shown once nothing more can be decided about it. */
  const dismiss = (id: string): void => {
    const offer = current()
    if (!offer || offer.id !== id || sending || OPEN.has(sync(offer))) return
    next()
  }

  return {
    /**
     * Puts a plan up for review, if it's a draft Ink can send. It moves to
     * awaiting review only once it's described, so a plan that can't be shown
     * stays a draft. `notify` hears each status it reaches from then on.
     */
    async offer(id: string, owner: string, notify: (status: PlanStatus) => void = () => {}): Promise<void> {
      const plan = store.get(id, owner)
      // Only a draft can move to awaiting review, so a plan already up can't be put up twice.
      if (!plan || plan.status !== 'draft') return
      const described = await describe(plan)
      if (!described) return
      const moved = store.move(id, owner, 'awaiting_review')
      if (!moved.ok) return
      queue.push({ id, owner, plan: described, notify, status: 'awaiting_review', failure: null, transactionId: null })
      notify('awaiting_review')
      if (queue.length === 1) shown()
      refresh()
    },

    state,
    refresh,

    /** The window came up or took focus: Approve waits ARM_DELAY_MS again, and input from before doesn't count. */
    shown() {
      shown()
      refresh()
    },

    /**
     * A real press of the mouse button, Enter or Space in the review window, as
     * Electron reported it. Only the press counts, never its release, so a press
     * from before the window armed can't approve when it's let go.
     */
    input() {
      inputAt = monotonic()
    },

    async approve(id: string, hash: string): Promise<ApproveResult> {
      const offer = current()
      if (!offer || offer.id !== id || offer.plan.hash !== hash) return refuse('stale')
      const now = monotonic()
      if (now < shownAt + ARM_DELAY_MS) return refuse('not-armed')
      const gesture = inputAt >= shownAt + ARM_DELAY_MS && now - inputAt <= GESTURE_WINDOW_MS
      // One click or key press approves once.
      inputAt = -Infinity
      if (!gesture) return refuse('no-gesture')
      if (sending) return refuse('busy')
      const status = sync(offer)
      if (!OPEN.has(status)) return refuse('cannot-move')
      if (!unlocked()) {
        offer.failure = 'locked'
        refresh()
        return refuse('locked')
      }
      // A plan approved before, whose send stopped short of signing, is sent again as it was approved.
      if (status === 'awaiting_review' && !store.move(id, offer.owner, 'approved').ok) return refuse('cannot-move')
      sending = true
      offer.failure = null
      refresh()
      try {
        const sent = await sender.send(id, offer.owner)
        if (sent.ok) offer.transactionId = sent.transactionId
        else offer.failure = reviewFailureOf(sent.reason)
      } finally {
        sending = false
        refresh()
      }
      return offer.failure ? refuse(offer.failure) : { ok: true }
    },

    reject,
    dismiss,

    /** The person closed the window: a plan still waiting on them counts as rejected, and a finished one as seen. */
    closed(): void {
      const offer = current()
      if (!offer) return
      if (OPEN.has(sync(offer))) reject(offer.id)
      else dismiss(offer.id)
    },
  }
}

export type ReviewBroker = ReturnType<typeof createReviewBroker>
