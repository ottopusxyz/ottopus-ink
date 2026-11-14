import type { Activity, ChatSwap, PlanJourney, RecentSwap } from '../../shared/ipc'
import type { PlanView } from './store'

/** The most plans Activity shows; the store keeps no more than its own limit anyway. */
export const ACTIVITY_MAX = 100

export interface ActivityDeps {
  /** Every plan the store keeps, newest first. */
  plans: readonly PlanView[]
  /** A plan's journey now. */
  journey: (plan: PlanView) => PlanJourney
  /** Where its swap stands, or all of a payment's legs together. */
  swap: (plan: PlanView) => ChatSwap | null
  /** Its last transaction, once one was sent. */
  transactionId: (plan: PlanView) => string | null
  /** The swaps Ink follows, newest first, by `<plan>` or `<plan>#<leg>`. */
  recent: readonly RecentSwap[]
}

/**
 * What the Activity page shows, all from main's own record: each plan of this run that
 * reached review (a draft was never shown to the person), with its journey; and the
 * swaps Ink still follows whose plans went with an earlier run.
 */
export function activityOf({ plans, journey, swap, transactionId, recent }: ActivityDeps): Activity {
  const shown = plans.filter((plan) => plan.status !== 'draft').slice(0, ACTIVITY_MAX)
  const ids = new Set(plans.map((plan) => plan.id))
  return {
    plans: shown.map((plan) => {
      const { intent } = plan.core
      const progress = swap(plan)
      const sent = transactionId(plan)
      return {
        createdAt: plan.core.createdAt,
        plan: {
          id: plan.id,
          status: plan.status,
          journey: journey(plan),
          ...(progress ? { swap: progress } : {}),
          ...(sent ? { transactionId: sent } : {}),
          outcome: intent.outcome,
          asset: intent.asset,
          amount: intent.amount,
          chain: intent.chain,
          to: intent.to,
          toAsset: intent.toAsset,
          toChain: intent.toChain,
        },
      }
    }),
    earlier: recent.filter((each) => !ids.has(each.planId.split('#')[0] as string)),
  }
}
