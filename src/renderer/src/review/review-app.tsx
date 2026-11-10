import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import type { ReviewFailure, ReviewState } from '../../../shared/review'
import { Otto, type PoseName } from '@/components/brand/otto'
import { InkHold } from '@/components/motion/loaders'
import { ArrowRightIcon } from '@/components/shell/icons'
import { Badge, Button, Callout, ChainLogo, TokenLogo } from '@/components/ui'
import { approveLabel, canApprove, failureText, groupAddress, outcomeOf, shortHash, timeLeft } from './review-copy'

/** Refusals about the click itself, which the plan's own state doesn't show. */
const CLICK_FAILURES: ReadonlySet<ReviewFailure> = new Set(['not-armed', 'no-gesture', 'stale', 'busy', 'cannot-move'])

/** Otto's pose for where the plan on show stands. He moves only while it waits on the person or goes out. */
function ottoFor(state: ReviewState): { pose: PoseName; moving: boolean } {
  if (state.sending) return { pose: 'loader', moving: true }
  switch (state.status) {
    case 'confirmed':
      return { pose: 'confirmed', moving: false }
    case 'failed':
    case 'blocked':
      return { pose: 'ink', moving: false }
    case 'cancelled':
    case 'expired':
      return { pose: 'base', moving: false }
    default:
      return state.failure === 'fee-changed' ? { pose: 'heads-up', moving: false } : { pose: 'plan-ready', moving: true }
  }
}

/**
 * The review window's page. It shows what main decoded from the plan's own
 * steps, in a fixed order: the network, who gets paid, the most that can
 * leave the account, each action, then the fee, the signer and the plan hash.
 * Every value is rendered as text. Main decides whether Approve counts; this
 * page only asks.
 */
export function ReviewApp() {
  const [state, setState] = useState<ReviewState | null | undefined>(undefined)
  /** What stopped the last click, for the plan it was about. */
  const [note, setNote] = useState<{ id: string; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let pushed = false
    const off = window.inkReview.onState((next) => {
      pushed = true
      setState(next)
    })
    void window.inkReview.state().then((first) => {
      // A pushed state is newer than the answer to this first ask.
      if (!pushed) setState(first)
    })
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [])

  if (state === undefined) return null
  if (state === null) {
    return (
      <Shell>
        <p className="m-0 text-[14px] text-[var(--ot-text-2)]">Nothing to review.</p>
      </Shell>
    )
  }

  const { plan } = state
  const outcome = outcomeOf(state)
  const left = timeLeft(plan.expiresAt, now)
  const otto = ottoFor(state)

  const approve = async (event: MouseEvent<HTMLButtonElement>) => {
    // Only a click or key press the browser itself made. Main checks again with what the OS reported.
    if (!event.isTrusted || !canApprove(state)) return
    setNote(null)
    const result = await window.inkReview.approve(plan.id, plan.hash)
    if (!result.ok && CLICK_FAILURES.has(result.reason)) setNote({ id: plan.id, text: failureText(result.reason) })
  }

  return (
    <Shell>
      <header className="flex items-center gap-3">
        <Otto pose={otto.pose} size={64} animated={otto.moving} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="ink-eyebrow">Your agent asks to</span>
          <h1 className="m-0 font-display text-[24px] font-bold tracking-[-0.02em]">Send {plan.amount} NEAR</h1>
        </div>
      </header>

      {state.sending ? (
        <InkHold title="Signing and sending…" detail={`${plan.amount} NEAR → ${plan.to}`}>
          <p className="m-0 text-[12.5px] text-[rgba(255,240,220,0.7)]">Keep Ink open until NEAR answers.</p>
        </InkHold>
      ) : state.status === 'confirmed' ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <Otto pose="confirmed" size={150} />
          <Badge tone="ok">Confirmed</Badge>
          <p className="m-0 font-display text-[30px] font-bold">Sent!</p>
          <p className="m-0 text-[14px] text-[var(--ot-text-2)]">
            NEAR ran the transaction. {plan.amount} NEAR is on its way to <span className="selectable font-mono">{plan.to}</span>.
          </p>
        </div>
      ) : (
        <>
        <div className="ink-review-network">
          <ChainLogo chain="near" size="sm" />
          <span className="font-semibold">{plan.network}</span>
          <span className="flex-1" />
          <span className="text-[11.5px] text-[var(--ot-text-3)]">not simulated</span>
        </div>

        <Section label="To" card>
          <div className="flex items-center gap-3">
            <span className="ink-avatar" aria-hidden>
              {plan.toKind === 'named' ? plan.to.slice(0, 1).toUpperCase() : '0x'}
            </span>
            <Address value={plan.to} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {plan.toWhy === 'typed' ? <Badge tone="warn">You typed this address in the chat</Badge> : <Badge tone="ok">Your own account</Badge>}
            {plan.toKind === 'named' ? null : <Badge>New if nothing was sent to it yet</Badge>}
          </div>
          {plan.toWhy === 'typed' ? (
            <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">Check every character against the address you meant. Funds sent to the wrong account can’t be taken back.</p>
          ) : null}
        </Section>

        <Section label="Amount" card>
          <p className="selectable m-0 flex items-center gap-2.5">
            <TokenLogo symbol="NEAR" chain="near" size="lg" />
            <span className="font-display text-[32px] leading-none font-bold tracking-[-0.02em]">{plan.amount} NEAR</span>
          </p>
          <p className="m-0 text-[13px] text-[var(--ot-text-2)]">
            {plan.maxFee ? (
              <>
                + up to <strong className="selectable">{plan.maxFee} NEAR</strong> network fee
              </>
            ) : (
              'Ink couldn’t read today’s fee. Approve asks NEAR again and shows the maximum, and nothing is signed until you approve that.'
            )}
          </p>
          {plan.maxTotal ? (
            <p className="m-0 border-t border-dashed border-[var(--ot-border)] pt-2 text-[11.5px] text-[var(--ot-text-3)]">
              Most that can leave your account: <span className="selectable font-mono text-[var(--ot-text-2)]">{plan.maxTotal} NEAR</span>. Most of
              the fee comes back.
            </p>
          ) : null}
        </Section>

        <Section label="Actions">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {plan.actions.map((action, index) => (
              <li key={index} className="ink-review-card flex items-center gap-3 py-3">
                <span className="ink-tool__glyph" style={{ background: '#FFD2C2' }} aria-hidden>
                  <ArrowRightIcon size={14} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[14px] font-semibold">
                    {action.kind} <span className="selectable font-mono">{action.amount} NEAR</span>
                  </span>
                  <span className="text-[12.5px] text-[var(--ot-text-3)]">{action.method ? `Calls ${action.method}` : 'Calls no contract'}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="m-0 text-[12px] text-[var(--ot-text-3)]">Not simulated: NEAR has no dry run.</p>
        </Section>

        <details className="ink-review-card ink-review-details" open>
          <summary>The exact details</summary>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 pt-2 text-[12.5px]">
            <Detail label="Fee">{plan.maxFee ? `Up to ${plan.maxFee} NEAR` : 'Not known yet'}</Detail>
            <Detail label="From">
              <Address value={plan.from} small />
            </Detail>
            <Detail label="Signing key">{plan.publicKey}</Detail>
            <Detail label="Exact amount">{plan.amountYocto} yoctoNEAR</Detail>
            <Detail label="Plan hash">{shortHash(plan.hash)}</Detail>
          </dl>
        </details>
        </>
      )}

      {!state.unlocked && !outcome ? (
        <Callout severity="caution" title="Ink is locked" compact>
          Unlock Ink in its main window to approve. This plan waits here.
        </Callout>
      ) : null}
      {state.failure && !outcome && state.failure !== 'locked' ? (
        <Callout severity="block" title="Not sent" compact>
          {failureText(state.failure)}
        </Callout>
      ) : null}
      {note?.id === plan.id && !outcome ? (
        <Callout severity="caution" title="Not approved" compact>
          {note.text}
        </Callout>
      ) : null}

      <footer className="mt-auto flex flex-col gap-3 border-t border-[var(--ot-border)] pt-4">
        {outcome ? (
          <>
            {/* Sending and sent have their own screen above, so they don't repeat it here. */}
            {state.sending || state.status === 'confirmed' ? null : (
              <Callout severity={outcome.tone} title={outcome.title} compact>
                {outcome.text}
              </Callout>
            )}
            {state.transactionId ? (
              <p className="m-0 text-[12.5px]">
                <span className="text-[var(--ot-text-3)]">Transaction </span>
                <a className="selectable font-mono [overflow-wrap:anywhere]" href={`https://nearblocks.io/txns/${state.transactionId}`} target="_blank" rel="noreferrer">
                  {state.transactionId}
                </a>
              </p>
            ) : null}
            {state.sending ? null : (
              <Button variant="secondary" fullWidth onClick={() => void window.inkReview.dismiss(plan.id)}>
                {state.waiting > 0 ? 'Next plan' : 'Done'}
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="m-0 text-[12.5px] text-[var(--ot-text-3)]">
              {left ? `Expires in ${left}.` : 'Expiring now.'} {state.waiting > 0 ? `${state.waiting} more waiting.` : ''}
            </p>
            <div className="flex gap-3">
              <Button variant="danger-outline" fullWidth onClick={() => void window.inkReview.reject(plan.id)}>
                Reject
              </Button>
              <Button variant="primary" fullWidth disabled={!canApprove(state)} onClick={(event) => void approve(event)}>
                {state.armed ? approveLabel(state) : 'Check the plan…'}
              </Button>
            </div>
          </>
        )}
      </footer>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="flex h-full flex-col gap-5 overflow-y-auto px-6 py-6">{children}</main>
}

function Section({ label, card = false, children }: { label: string; card?: boolean; children: ReactNode }) {
  return (
    <section className={card ? 'ink-review-card flex flex-col gap-2' : 'flex flex-col gap-2'}>
      <h2 className="ink-eyebrow m-0">{label}</h2>
      {children}
    </section>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-[var(--ot-text-3)]">{label}</dt>
      <dd className="selectable m-0 min-w-0 font-mono [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/** An address in full, in groups, so it can be checked character by character. */
function Address({ value, small = false }: { value: string; small?: boolean }) {
  return (
    <p className={`selectable m-0 flex flex-wrap gap-x-2 font-mono font-medium ${small ? 'text-[12.5px]' : 'text-[16px]'}`} aria-label={value}>
      {groupAddress(value).map((group, index) => (
        <span key={index}>{group}</span>
      ))}
    </p>
  )
}
