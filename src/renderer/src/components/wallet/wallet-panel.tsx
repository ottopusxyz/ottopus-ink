import type { ReactNode, TextareaHTMLAttributes } from 'react'
import { Sea } from '@/components/motion/sea'
import { cn } from '@/lib/cn'

/** The one panel the setup and lock screens fill, with nothing else in the window to click. */
export function WalletPanel({ children }: { children: ReactNode }) {
  return (
    <main className="ink-panel" id="main">
      <Sea shafts={false} />
      <div className="ink-panel__scroll flex justify-center px-6 py-14">
        <div className="flex w-full max-w-[540px] flex-col gap-5">{children}</div>
      </div>
    </main>
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
