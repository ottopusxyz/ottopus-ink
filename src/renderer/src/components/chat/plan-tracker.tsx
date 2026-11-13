import type { ChatPlan } from '../../../../shared/ipc'
import { Ring } from '@/components/motion/ring'
import { CheckIcon, ChevronDownIcon, CloseIcon, ExternalIcon } from '@/components/shell/icons'
import { TokenLogo } from '@/components/ui'
import { StatusChip } from '@/components/ui/status-chip'
import { planHeadline } from '@/lib/chats'
import { trackerSteps, trackerSummary, type TrackerStep } from '@/lib/plan-tracker'
import { cn } from '@/lib/cn'

const DOT: Record<TrackerStep['state'], string> = {
  done: 'border-[var(--ot-ok)] bg-[var(--ot-ok)] text-white',
  active: 'border-[var(--ot-plan)] bg-[var(--ot-plan-bg)] text-[var(--ot-plan-text)]',
  pending: 'border-[var(--ot-border)] bg-[var(--ot-surface)] text-[var(--ot-text-3)]',
  failed: 'border-[var(--ot-block)] bg-[var(--ot-block)] text-white',
}

function StepDot({ state }: { state: TrackerStep['state'] }) {
  return (
    <span className={cn('flex size-[22px] flex-none items-center justify-center rounded-full border-2', DOT[state])} aria-hidden>
      {state === 'done' ? <CheckIcon size={12} /> : state === 'failed' ? <CloseIcon size={12} /> : state === 'active' ? <Ring size={12} tone="plan" /> : null}
    </span>
  )
}

/**
 * Where this chat's plan stands, pinned above the conversation: each step from review
 * through signing and NEAR to, for a swap, NEAR Intents' payout, with explorer links as
 * they arrive. Earlier plans of the chat fold away below it. Every state comes from
 * main's events, never from the agent's words.
 */
export function PlanTracker({ plan, earlier }: { plan: ChatPlan; earlier: readonly ChatPlan[] }) {
  const steps = trackerSteps(plan)
  return (
    <section className="ink-review-card relative mx-auto mt-3 flex w-[calc(100%-48px)] max-w-[760px] flex-col gap-3 py-3" aria-label="Where this plan stands">
      <div className="flex items-center gap-2.5">
        <TokenLogo symbol={plan.asset} chain={plan.chain} size="md" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] font-bold">{planHeadline(plan)}</span>
          <span className="text-[12px] text-[var(--ot-text-2)]" role="status">
            {trackerSummary(plan)}
          </span>
        </span>
        <StatusChip status={plan.status} />
      </div>
      <ol className="m-0 flex list-none flex-wrap items-start gap-x-1 gap-y-2 p-0">
        {steps.map((step, index) => (
          <li key={step.label} className="flex min-w-[96px] flex-1 items-start gap-1.5">
            <StepDot state={step.state} />
            <span className="flex min-w-0 flex-col">
              <span className={cn('text-[12.5px] font-semibold', step.state === 'pending' && 'text-[var(--ot-text-3)]')}>{step.label}</span>
              {step.detail ? <span className="selectable text-[11.5px] text-[var(--ot-text-2)] [overflow-wrap:anywhere]">{step.detail}</span> : null}
              {step.link ? (
                <a className="flex items-center gap-1 text-[11.5px] underline" href={step.link.url} target="_blank" rel="noreferrer">
                  {step.link.label}
                  <ExternalIcon size={10} />
                </a>
              ) : null}
            </span>
            {index < steps.length - 1 ? <span className="mt-[10px] hidden h-[2px] flex-1 rounded bg-[var(--ot-border)] sm:block" aria-hidden /> : null}
          </li>
        ))}
      </ol>
      {earlier.length > 0 ? (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] text-[var(--ot-text-3)]">
            <ChevronDownIcon size={12} className="transition-transform group-open:rotate-180" />
            {earlier.length === 1 ? '1 earlier plan in this chat' : `${earlier.length} earlier plans in this chat`}
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
            {earlier.map((other) => (
              <li key={other.id} className="flex items-center gap-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate">{planHeadline(other)}</span>
                <span className="text-[11.5px] text-[var(--ot-text-3)]">{trackerSummary(other)}</span>
                <StatusChip status={other.status} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
