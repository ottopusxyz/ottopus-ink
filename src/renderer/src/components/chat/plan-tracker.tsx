import type { ChatPlan } from '../../../../shared/ipc'
import { Ring } from '@/components/motion/ring'
import { ArrowRightIcon, CheckIcon, ChevronDownIcon, CloseIcon, ExternalIcon, EyeIcon, KeyIcon, SwapIcon } from '@/components/shell/icons'
import { ChainLogo, TokenLogo } from '@/components/ui'
import { isChainId } from '@/lib/logos'
import { StatusChip } from '@/components/ui/status-chip'
import { planHeadline } from '@/lib/chats'
import { trackerSteps, trackerSummary, type TrackerIcon, type TrackerStep } from '@/lib/plan-tracker'
import { shortAmounts } from '@/lib/amounts'
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

/** A step's own icon: Ink's glyph for its steps, or the chain or token it lands on. */
function StepIcon({ icon }: { icon: TrackerIcon }) {
  switch (icon.kind) {
    case 'review':
      return <EyeIcon size={14} className="flex-none text-[var(--ot-text-2)]" />
    case 'sign':
      return <KeyIcon size={14} className="flex-none text-[var(--ot-text-2)]" />
    case 'swap':
      return <SwapIcon size={14} className="flex-none text-[var(--ot-text-2)]" />
    case 'chain': {
      const chain = icon.chain.toLowerCase()
      return isChainId(chain) ? <ChainLogo chain={chain} size="xs" /> : null
    }
    case 'token':
      // The label names the chain: at this size its badge would cover the token's own mark.
      return <TokenLogo symbol={icon.symbol} size="xs" />
  }
}

/**
 * A plan's headline, where it stands, and each of its steps from review through signing
 * and its chains to the money landing, with explorer links as they arrive.
 */
export function PlanSteps({ plan }: { plan: ChatPlan }) {
  const steps = trackerSteps(plan)
  return (
    <>
      <div className="flex items-center gap-2.5">
        <span className="flex flex-none items-center gap-1" aria-hidden>
          <TokenLogo symbol={plan.asset} chain={plan.chain} size="md" />
          {plan.outcome === 'swap' && plan.toAsset ? (
            <>
              <ArrowRightIcon size={13} className="text-[var(--ot-text-3)]" />
              <TokenLogo symbol={plan.toAsset} chain={plan.toChain} size="md" />
            </>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] font-bold">{planHeadline(plan)}</span>
          <span className="text-[12px] text-[var(--ot-text-2)]" role="status">
            {trackerSummary(plan)}
          </span>
        </span>
        <StatusChip status={plan.status} />
      </div>
      {/* Each step is a column: its dot and the line to the next on top, its words below with the column's whole width. */}
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(84px,1fr))] items-start gap-y-3 p-0">
        {steps.map((step, index) => (
          <li key={step.label} className="flex min-w-0 flex-col gap-1.5">
            <span className="flex items-center gap-1.5" aria-hidden>
              <StepDot state={step.state} />
              {index < steps.length - 1 ? <span className={cn('h-[2px] flex-1 rounded', step.state === 'done' ? 'bg-[var(--ot-ok)]' : 'bg-[var(--ot-border)]')} /> : null}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 pr-2.5">
              <span className={cn('text-[12.5px] leading-[1.35] font-semibold [overflow-wrap:anywhere]', step.state === 'pending' && 'text-[var(--ot-text-3)]')} title={step.label}>
                <span className="mr-1 inline-flex align-[-2px]">
                  <StepIcon icon={step.icon} />
                </span>
                {shortAmounts(step.label)}
              </span>
              {step.detail ? (
                <span className="selectable text-[11.5px] leading-[1.35] text-[var(--ot-text-2)] [overflow-wrap:anywhere]" title={step.detail}>
                  {shortAmounts(step.detail)}
                </span>
              ) : null}
              {step.link ? (
                <a className="flex w-fit items-center gap-1 text-[11.5px] underline" href={step.link.url} target="_blank" rel="noreferrer">
                  {step.link.label}
                  <ExternalIcon size={10} />
                </a>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}

/**
 * Where this chat's plan stands, pinned above the conversation, with earlier plans of the
 * chat folded away below it. Every state comes from main's events, never from the agent's words.
 */
export function PlanTracker({ plan, earlier }: { plan: ChatPlan; earlier: readonly ChatPlan[] }) {
  return (
    <section className="ink-review-card relative mx-auto mt-3 flex w-[calc(100%-48px)] max-w-[760px] flex-col gap-3 py-3" aria-label="Where this plan stands">
      <PlanSteps plan={plan} />
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
