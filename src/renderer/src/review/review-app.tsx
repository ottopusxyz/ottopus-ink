import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { ReviewFailure, ReviewState } from '../../../shared/review'
import { Otto, type PoseName } from '@/components/brand/otto'
import { InkHold, StepList } from '@/components/motion/loaders'
import { ArrowRightIcon, CheckIcon, ClockIcon, ExternalIcon } from '@/components/shell/icons'
import { Badge, Button, buttonClasses, Callout, ChainLogo, TokenLogo } from '@/components/ui'
import { ACCOUNT_KIND, approveLabel, canApprove, failureText, groupAddress, outcomeOf, sendSteps, shortHash, timeLeft } from './review-copy'

/** Refusals about the click itself, which the plan's own state doesn't show. */
const CLICK_FAILURES: ReadonlySet<ReviewFailure> = new Set(['not-armed', 'no-gesture', 'stale', 'busy', 'cannot-move'])

/**
 * Otto's pose in the header for where the plan on show stands. Sending and sent
 * have their own bigger Otto instead. He moves only while the plan waits on the person.
 */
function ottoFor(state: ReviewState): { pose: PoseName; moving: boolean } {
  switch (state.status) {
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
  /** The fee ceiling this window last showed for a plan, and the one before it once it rose. */
  const seenFee = useRef<{ id: string; fee: string | null } | null>(null)
  const [rose, setRose] = useState<{ id: string; from: string; to: string } | null>(null)

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

  // Main raised the fee ceiling: keep the old one to strike through beside the new.
  useEffect(() => {
    if (!state) return
    const { id, maxFee } = state.plan
    const seen = seenFee.current
    if (seen?.id === id && seen.fee && maxFee && seen.fee !== maxFee && state.failure === 'fee-changed') setRose({ id, from: seen.fee, to: maxFee })
    seenFee.current = { id, fee: maxFee }
  }, [state])

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
  const fullScreen = state.sending || state.status === 'confirmed'
  const feeRose = rose?.id === plan.id && rose.to === plan.maxFee ? rose.from : null

  const approve = async (event: MouseEvent<HTMLButtonElement>) => {
    // Only a click or key press the browser itself made. Main checks again with what the OS reported.
    if (!event.isTrusted || !canApprove(state)) return
    setNote(null)
    const result = await window.inkReview.approve(plan.id, plan.hash)
    if (!result.ok && CLICK_FAILURES.has(result.reason)) setNote({ id: plan.id, text: failureText(result.reason) })
  }

  return (
    <Shell>
      {/* One Otto at a time: sending and sent have their own, bigger one, and no header. */}
      {fullScreen ? null : (
        <header className="flex items-center gap-3">
          <Otto pose={otto.pose} size={64} animated={otto.moving} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="ink-eyebrow">Your agent asks to</span>
            <h1 className="m-0 font-display text-[24px] font-bold tracking-[-0.02em]">Send {plan.amount} NEAR</h1>
          </div>
          {outcome ? null : (
            <div className="flex flex-none flex-col items-end gap-1.5">
              <Badge tone="plan">
                <span className="ink-status-dot" aria-hidden />
                To review
              </Badge>
              <span className="flex items-center gap-1 font-mono text-[12px] font-bold text-[var(--ot-text-2)]" aria-label={left ? `Expires in ${left}` : 'Expiring now'}>
                <ClockIcon size={13} />
                {left ?? '0:00'}
              </span>
            </div>
          )}
        </header>
      )}

      {state.sending ? (
        <InkHold title="Signing and sending…" detail={`${plan.amount} NEAR → ${plan.to} · ${plan.network}`}>
          <div className="flex flex-col items-center gap-3">
            <div className="w-[230px] text-left">
              <StepList steps={sendSteps(state)} tone="dark" />
            </div>
            <p className="m-0 text-[12px] text-[rgba(255,240,220,0.62)]">This window stays open until NEAR answers.</p>
          </div>
        </InkHold>
      ) : state.status === 'confirmed' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4 text-center">
          <Otto pose="confirmed" size={170} />
          <Badge tone="ok">
            <span className="ink-status-dot" aria-hidden />
            Confirmed
          </Badge>
          <h1 className="m-0 font-display text-[34px] font-bold">Sent!</h1>
          <p className="m-0 text-[14px] text-[var(--ot-text-2)]">
            NEAR ran the transaction. {plan.amount} NEAR is on its way to <span className="selectable font-mono">{plan.to}</span>.
          </p>
          {state.transactionId ? (
            <div className="ink-review-card ink-review-card--stk flex w-full items-center gap-2.5 text-left">
              <ChainLogo chain="near" size="md" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="ink-eyebrow">Transaction</span>
                <span className="selectable font-mono text-[12.5px]" title={state.transactionId}>
                  {shortHash(state.transactionId)}
                </span>
              </div>
              <a
                className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'gap-1.5' })}
                href={`https://nearblocks.io/txns/${state.transactionId}`}
                target="_blank"
                rel="noreferrer"
              >
                nearblocks.io
                <ExternalIcon size={12} />
              </a>
            </div>
          ) : null}
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
            <div className="flex min-w-0 flex-col gap-0.5">
              <Address value={plan.to} />
              <span className="text-[12px] text-[var(--ot-text-3)]">{ACCOUNT_KIND[plan.toKind]}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="ok">
              <CheckIcon size={12} />
              {plan.toWhy === 'typed' ? 'You typed this address in the chat' : 'Your own account'}
            </Badge>
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
            <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-dashed border-[var(--ot-border)] pt-2 text-[11.5px]">
              <dt className="text-[var(--ot-text-3)]">Most that can leave</dt>
              <dd className="selectable m-0 text-right font-mono">{plan.maxTotal} NEAR</dd>
              <dt className="text-[var(--ot-text-3)]">Network fee, at most</dt>
              <dd className={feeRose ? 'selectable m-0 rounded-md bg-[var(--ot-warn-bg)] px-1.5 text-right font-mono font-bold text-[var(--ot-warn-text)]' : 'selectable m-0 text-right font-mono'}>
                {feeRose ? <s className="mr-1 font-medium text-[var(--ot-text-3)]">{feeRose}</s> : null}
                {plan.maxFee} NEAR
              </dd>
              <dd className="col-span-2 m-0 text-[var(--ot-text-3)]">Most of the fee comes back.</dd>
            </dl>
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
                  <span className="text-[13.5px] font-bold">
                    {plan.actions.length === 1 ? '1 action · ' : `${index + 1} of ${plan.actions.length} · `}
                    {action.kind} <span className="selectable font-mono">{action.amount} NEAR</span>
                  </span>
                  <span className="text-[12px] text-[var(--ot-text-3)]">
                    {action.method ? `Calls ${action.method}.` : 'Calls no contract.'}
                    {plan.actions.length === 1 ? ' Nothing else in this transaction.' : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
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
      {state.failure === 'fee-changed' && !outcome ? (
        <Callout severity="caution" title="The fee could cost more now." compact>
          Nothing was signed. Check the new maximum, then approve again.
        </Callout>
      ) : state.failure && !outcome && state.failure !== 'locked' ? (
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
            {state.transactionId && !fullScreen ? (
              <p className="m-0 text-[12.5px]">
                <span className="text-[var(--ot-text-3)]">Transaction </span>
                <a className="selectable font-mono [overflow-wrap:anywhere]" href={`https://nearblocks.io/txns/${state.transactionId}`} target="_blank" rel="noreferrer">
                  {state.transactionId}
                </a>
              </p>
            ) : null}
            {state.sending ? (
              <Button variant="secondary" fullWidth disabled>
                Close
              </Button>
            ) : (
              <Button
                variant={state.status === 'confirmed' ? 'primary' : 'secondary'}
                fullWidth
                onClick={() => void window.inkReview.dismiss(plan.id)}
              >
                {state.waiting > 0 ? 'Next plan' : 'Done'}
              </Button>
            )}
          </>
        ) : (
          <>
            {state.armed ? null : (
              <div className="ink-tide" aria-hidden>
                <span />
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="danger-outline" className="flex-1" onClick={() => void window.inkReview.reject(plan.id)}>
                Reject
              </Button>
              <Button variant="primary" className="flex-[2]" disabled={!canApprove(state)} onClick={(event) => void approve(event)}>
                {state.armed ? approveLabel(state) : 'Check the plan…'}
              </Button>
            </div>
            <p className="m-0 text-center text-[11.5px] text-[var(--ot-text-3)]">
              {state.armed ? 'Click, or press Enter. Nothing is signed until you do.' : 'Approve wakes up a moment after this window comes to the front.'}
              {state.waiting > 0 ? ` ${state.waiting} more waiting.` : ''}
            </p>
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
