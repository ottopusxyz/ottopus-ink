import { EmptyState } from '@/components/ui'
import { Sea } from '@/components/motion/sea'
import { PlanSteps } from '@/components/chat/plan-tracker'
import { SwapBanner } from '@/components/home/swap-banner'
import { useActivity, whenMade } from '@/lib/activity'

/**
 * Everything Ink has done lately: each plan of this run that reached review, newest
 * first, with every step from review to the money landing and its explorer links; then
 * the swaps Ink still follows from before it last started. Every value comes from main.
 */
export function ActivityView() {
  const { activity, loaded } = useActivity()
  const empty = activity.plans.length === 0 && activity.earlier.length === 0
  return (
    <main className="ink-panel" id="main">
      <Sea shafts={false} />
      <div className="ink-panel__scroll flex flex-col gap-6 px-7 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[26px] font-bold tracking-[-0.02em]">Activity</h1>
          <p className="m-0 text-[13px] text-[var(--ot-text-2)]">Every plan you were asked to review, and each step of it, tracked until it lands.</p>
        </div>
        {loaded && empty ? (
          <EmptyState className="mt-6" title="Nothing yet" description="Plans your agent makes show here once they’re ready for you to review, with every step until the money lands." />
        ) : null}
        {activity.plans.length > 0 ? (
          <section className="flex flex-col gap-3" aria-label="Plans">
            {activity.plans.map(({ plan, createdAt }) => (
              <article key={plan.id} className="ink-review-card flex flex-col gap-3 py-3" aria-label={plan.outcome}>
                <PlanSteps plan={plan} when={whenMade(createdAt)} />
              </article>
            ))}
          </section>
        ) : null}
        {activity.earlier.length > 0 ? (
          <section className="flex flex-col gap-2" aria-label="From before Ink restarted">
            <h2 className="m-0 text-[13px] font-semibold text-[var(--ot-text-2)]">From before Ink last started</h2>
            {activity.earlier.map((swap) => (
              <SwapBanner key={swap.planId} swap={swap} />
            ))}
          </section>
        ) : null}
      </div>
    </main>
  )
}
