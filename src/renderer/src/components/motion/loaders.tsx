import type { ReactNode } from 'react'
import { Otto } from '@/components/brand/otto'
import { CheckIcon } from '@/components/shell/icons'
import { cn } from '@/lib/cn'

export interface LoaderStep {
  label: string
  status: 'done' | 'active' | 'pending'
}

/**
 * L3 · Step panel's list: named steps rather than a percentage. Every step is
 * drawn whatever its status, so moving on never reflows the list.
 */
export function StepList({ steps, tone = 'light' }: { steps: readonly LoaderStep[]; tone?: 'light' | 'dark' }) {
  const done = tone === 'dark' ? 'text-[#7BE3B8]' : 'text-[var(--ot-ok-text)]'
  const pending = tone === 'dark' ? 'opacity-50' : 'text-[var(--ot-text-3)]'
  return (
    <ol className="ink-steps">
      {steps.map((step) => (
        <li key={step.label} className={step.status === 'done' ? done : step.status === 'pending' ? pending : undefined}>
          <span className="ink-steps__mark" aria-hidden>
            {step.status === 'done' ? (
              <CheckIcon size={13} />
            ) : step.status === 'active' ? (
              <span className={cn('ink-dots', tone === 'light' && 'text-[var(--ot-plan)]')}>
                <i />
                <i />
                <i />
              </span>
            ) : (
              '·'
            )}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  )
}

/**
 * L6 · Ink hold: the one dark loader, for a wait that's out of the app's hands,
 * such as a transaction on its way. Otto juggles in the middle of two ripples.
 */
export function InkHold({ title, detail, className, children }: { title: string; detail?: string; className?: string; children?: ReactNode }) {
  return (
    <div role="status" className={cn('ink-hold', className)}>
      <span className="ink-hold__ripple" aria-hidden />
      <span className="ink-hold__ripple ink-hold__ripple--late" aria-hidden />
      <Otto pose="loader" size={140} animated className="relative" />
      <div className="relative flex flex-col items-center gap-1.5">
        <p className="m-0 font-display text-[21px] font-bold">{title}</p>
        {detail ? <p className="m-0 font-mono text-[12px] text-[rgba(255,240,220,0.68)]">{detail}</p> : null}
      </div>
      {children ? <div className="relative">{children}</div> : null}
    </div>
  )
}
