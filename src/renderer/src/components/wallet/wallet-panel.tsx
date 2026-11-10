import type { ReactNode, TextareaHTMLAttributes } from 'react'
import { Otto, type PoseName } from '@/components/brand/otto'
import { Sea } from '@/components/motion/sea'
import { CheckIcon } from '@/components/shell/icons'
import { cn } from '@/lib/cn'

/** What Otto says beside a setup or lock step, and how he stands while saying it. */
export interface Guide {
  pose: PoseName
  title: string
  text: string
  /** Big and moving on welcome and lock; smaller and still while someone types words or a password. */
  calm?: boolean
}

/** The steps of making a wallet, for the progress above the form. */
export const SETUP_STEPS = ['Write down', 'Check', 'Password'] as const

/**
 * The setup and lock screens: Otto on a seabed on the left, saying what this
 * step is for, and the form on the right with the step's progress above it.
 * Nothing else in the window is there to click.
 */
export function WalletPanel({ guide, step, children }: { guide: Guide; step?: number; children: ReactNode }) {
  return (
    <>
      <aside className="ink-panel ink-stage" aria-label="Otto explains this step">
        <Sea shafts />
        <div className="ink-stage__floor" aria-hidden />
        <div className="relative flex h-full flex-col justify-end gap-4 p-6">
          <div className="ink-stage__bubble">
            <span className="ink-eyebrow text-[var(--ot-coral-text)]">Otto says</span>
            <span className="font-display text-[20px] leading-[1.2] font-bold">{guide.title}</span>
            <span className="text-[13.5px] leading-[1.5] text-[var(--ot-text-2)]">{guide.text}</span>
          </div>
          <Otto pose={guide.pose} size={guide.calm ? 150 : 220} animated={!guide.calm} className="mb-2 self-center" />
        </div>
      </aside>
      <main className="ink-panel" id="main">
        <Sea shafts={false} />
        <div className="ink-panel__scroll flex justify-center px-6 py-12">
          <div className="my-auto flex w-full max-w-[540px] flex-col gap-5">
            {step !== undefined ? <SetupProgress at={step} /> : null}
            {children}
          </div>
        </div>
      </main>
    </>
  )
}

/** Where a new wallet's setup is: done, this one, still to come. */
function SetupProgress({ at }: { at: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <ol className="ink-progress" aria-label={`Step ${at + 1} of ${SETUP_STEPS.length}`}>
        {SETUP_STEPS.map((label, i) => (
          <li key={label} className={cn('ink-progress__step', i < at && 'ink-progress__step--done', i === at && 'ink-progress__step--on')}>
            <span className="ink-progress__dot" aria-hidden>
              {i < at ? <CheckIcon size={12} /> : i + 1}
            </span>
            <span className="ink-progress__label">{label}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function WalletHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="m-0 font-display text-[30px] leading-[1.1] font-bold tracking-[-0.02em]">{title}</h1>
      {children ? <p className="m-0 text-[14.5px] leading-[1.55] text-[var(--ot-text-2)]">{children}</p> : null}
    </div>
  )
}

/** A labelled field with room for a hint or an error under it. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[var(--ot-text)]">{label}</span>
      {children}
      {error ? (
        <span className="text-[12.5px] text-[var(--ot-block-text)]">{error}</span>
      ) : hint ? (
        <span className="text-[12.5px] text-[var(--ot-text-3)]">{hint}</span>
      ) : null}
    </label>
  )
}

/** Input's treatment for several lines, with every browser helper off: a recovery phrase must reach no spellchecker. */
export function PhraseInput({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      rows={4}
      className={cn(
        'w-full min-w-0 resize-none rounded-[10px] border border-[var(--ot-border-strong)] bg-[var(--ot-surface-2)] px-3 py-[10px]',
        'font-mono text-[13px] leading-[1.6] text-[var(--ot-text)] placeholder:text-[var(--ot-text-4)]',
        className,
      )}
      {...props}
    />
  )
}

/** A failure, worded to say what to do next. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="m-0 rounded-[10px] bg-[var(--ot-block-bg)] px-3.5 py-2.5 text-[13.5px] text-[var(--ot-block-text)]">
      {message}
    </p>
  )
}
