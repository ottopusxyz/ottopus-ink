import type { ChatPlan } from '../../../../shared/ipc'
import type { PlanStatus } from '../../../../shared/plan'
import { Otto, type PoseName } from '@/components/brand/otto'
import { StatusChip, TokenLogo } from '@/components/ui'
import { planHeadline } from '@/lib/chats'

/** Otto's pose for where a plan stands: holding it up, juggling while it goes, cheering, or in the ink. */
const POSE: Record<PlanStatus, PoseName> = {
  draft: 'plan-ready',
  awaiting_review: 'plan-ready',
  approved: 'plan-ready',
  signing: 'loader',
  submitted: 'loader',
  confirmed: 'confirmed',
  failed: 'ink',
  blocked: 'ink',
  cancelled: 'base',
  expired: 'base',
}

/** Otto only moves while the plan does: waiting on the person, or on its way. */
const MOVING = new Set<PlanStatus>(['awaiting_review', 'signing', 'submitted'])

const KIND: Record<ChatPlan['outcome'], string> = { send: 'Send', swap: 'Swap', stake: 'Stake' }

/**
 * A plan an agent proposed, as a ticket: what leaves and where it goes as the
 * lead line, Otto in a pocket beside it, and the details under a perforation.
 * There is nothing to press here: a plan is approved only in the review window.
 *
 * The agent wrote every value here, and they're shown as written. That includes
 * the address in full, since a shortened one hides what a person needs to compare.
 */
export function PlanCard({ plan }: { plan: ChatPlan }) {
  const target = plan.outcome === 'swap' ? plan.toAsset : plan.to
  const details = [
    ['On', plan.chain],
    ['To', plan.to],
    ['Arriving on', plan.toChain],
  ].filter((row): row is [string, string] => row[1] !== null)

  return (
    <article className="ink-ticket" aria-label={`Plan: ${planHeadline(plan)}`}>
      <div className="ink-ticket__head">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ink-eyebrow">{KIND[plan.outcome]} plan</span>
            <StatusChip status={plan.status} />
          </div>
          <p className="ink-ticket__lead selectable m-0">
            <TokenLogo symbol={plan.asset} chain={plan.chain} size="lg" />
            <span className="ink-ticket__amount">
              {plan.amount} {plan.asset}
            </span>
            {target ? (
              <>
                <svg className="ink-ticket__arrow" width="44" height="18" viewBox="0 0 64 22" aria-label="to" role="img">
                  <path d="M2 11 C16 2 28 20 42 11 S56 6 60 11" fill="none" stroke="var(--ot-coral)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 7" />
                  <path d="m54 5 7 6-7 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {plan.outcome === 'swap' && plan.toAsset ? <TokenLogo symbol={plan.toAsset} chain={plan.toChain} size="lg" /> : null}
                <span className="ink-ticket__to">{target}</span>
              </>
            ) : null}
          </p>
        </div>
        <span className="ink-ticket__pocket">
          <Otto pose={POSE[plan.status]} size={76} animated={MOVING.has(plan.status)} />
        </span>
      </div>
      <div className="ink-ticket__perf" aria-hidden />
      <div className="ink-ticket__foot">
        {details.length > 0 ? (
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-[var(--ot-text-3)]">{label}</dt>
                <dd className="selectable m-0 min-w-0 font-mono [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p className="m-0 text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">
          {plan.status === 'draft'
            ? 'If Ink can send this, it opens in Ink’s review window. Nothing is signed unless you approve it there.'
            : 'Check it in Ink’s review window. Nothing is signed unless you approve it there.'}
        </p>
        <span className="selectable font-mono text-[11.5px] text-[var(--ot-text-3)]">{plan.id}</span>
      </div>
    </article>
  )
}
