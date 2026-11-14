import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { ReviewFailure, ReviewLeg, ReviewPlan, ReviewState, ReviewSwap } from '../../../shared/review'
import { Otto, type PoseName } from '@/components/brand/otto'
import { InkHold, StepList } from '@/components/motion/loaders'
import { ArrowRightIcon, CheckIcon, ClockIcon, ExternalIcon } from '@/components/shell/icons'
import { Badge, Button, buttonClasses, Callout, TokenLogo } from '@/components/ui'
import { ChainMark } from '@/components/wallet/chain-mark'
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
            <h1 className="m-0 font-display text-[24px] font-bold tracking-[-0.02em]">{plan.kind === 'pay' ? `Pay ${plan.amount} ${plan.asset}` : plan.swap ? `Swap ${plan.swap.send}` : `Send ${plan.amount} ${plan.asset}`}</h1>
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
        <InkHold
          className="min-h-[420px] flex-1"
          title="Signing and sending…"
          detail={plan.swap ? `${plan.swap.send} → about ${plan.swap.get} · ${plan.network}` : `${plan.amount} ${plan.asset} → ${plan.to} · ${plan.network}`}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="w-[230px] text-left">
              <StepList steps={sendSteps(state)} tone="dark" />
            </div>
            <p className="m-0 text-[12px] text-[rgba(255,240,220,0.62)]">This window stays open until {plan.chain} answers.</p>
          </div>
        </InkHold>
      ) : state.status === 'confirmed' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4 text-center">
          <Otto pose="confirmed" size={170} />
          <Badge tone="ok">
            <span className="ink-status-dot" aria-hidden />
            Confirmed
          </Badge>
          <h1 className="m-0 font-display text-[34px] font-bold">{plan.swap || plan.kind === 'pay' ? 'Deposit sent!' : 'Sent!'}</h1>
          {plan.kind === 'pay' && plan.payChain ? (
            <p className="m-0 text-[14px] text-[var(--ot-text-2)]">
              {plan.chain} ran every part. NEAR Intents pays exactly <span className="selectable font-mono">{plan.amount} {plan.asset}</span> to{' '}
              <span className="selectable font-mono">{plan.to}</span> on {plan.payChain.name}. Your chat shows when it lands.
            </p>
          ) : plan.swap ? (
            <p className="m-0 text-[14px] text-[var(--ot-text-2)]">
              {plan.chain} ran the deposit. NEAR Intents swaps it for about <span className="selectable font-mono">{plan.swap.get}</span> {landsIn(plan.swap)}, usually within{' '}
              {plan.swap.seconds} seconds. Your chat shows when it lands.
            </p>
          ) : (
            <p className="m-0 text-[14px] text-[var(--ot-text-2)]">
              {plan.chain} ran the transaction. {plan.amount} {plan.asset} is on its way to <span className="selectable font-mono">{plan.to}</span>.
            </p>
          )}
          {state.transactionId ? (
            <div className="ink-review-card ink-review-card--stk flex w-full items-center gap-2.5 text-left">
              <ChainMark chain={{ mark: plan.chainMark, name: plan.chain }} size="md" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="ink-eyebrow">Transaction</span>
                <span className="selectable font-mono text-[12.5px]" title={state.transactionId}>
                  {shortHash(state.transactionId)}
                </span>
              </div>
              <a
                className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'gap-1.5' })}
                href={`${plan.explorer.tx}${state.transactionId}`}
                target="_blank"
                rel="noreferrer"
              >
                {plan.explorer.name}
                <ExternalIcon size={12} />
              </a>
            </div>
          ) : null}
        </div>
      ) : (
        <>
        <div className="ink-review-network">
          <ChainMark chain={{ mark: plan.chainMark, name: plan.chain }} size="sm" />
          <span className="font-semibold">{plan.network}</span>
          <span className="flex-1" />
          <span className="text-[11.5px] text-[var(--ot-text-3)]">not simulated</span>
        </div>

        {plan.swap ? (
          <SwapTerms plan={plan} swap={plan.swap} />
        ) : (
        <Section label="To" card>
          <div className="flex items-center gap-3">
            <span className="ink-avatar" aria-hidden>
              {plan.toKind === 'named' ? plan.to.slice(0, 1).toUpperCase() : plan.toKind === 'solana' ? 'S' : '0x'}
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
            {plan.toKind === 'implicit' || plan.toKind === 'eth-implicit' ? <Badge>New if nothing was sent to it yet</Badge> : null}
          </div>
          {plan.toWhy === 'typed' ? (
            <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">Check every character against the address you meant. Funds sent to the wrong account can’t be taken back.</p>
          ) : null}
        </Section>
        )}

        {plan.legs && plan.payout ? <PayTerms legs={plan.legs} payout={plan.payout} to={plan.to} on={plan.payChain?.name ?? ''} /> : null}
        <Section label="Amount" card>
          <p className="selectable m-0 flex items-center gap-2.5">
            <TokenLogo symbol={plan.asset} chain={plan.payChain?.mark ?? plan.chainMark} size="lg" />
            <span className="font-display text-[32px] leading-none font-bold tracking-[-0.02em]">
              {plan.amount} {plan.asset}
            </span>
          </p>
          {plan.swap?.from === 'intents' ? <p className="m-0 text-[13px] font-semibold text-[var(--ot-text-2)]">From your NEAR Intents balance</p> : null}
          {plan.kind === 'pay' && plan.payChain ? <p className="m-0 text-[13px] font-semibold text-[var(--ot-text-2)]">Exactly this, paid on {plan.payChain.name}</p> : null}
          {plan.stepFees ? (
            <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-dashed border-[var(--ot-border)] pt-2 text-[11.5px]">
              {plan.stepFees.map((fee, index) => (
                <div key={index} className="contents">
                  <dt className="text-[var(--ot-text-3)]">Network fee on {fee.chain}, at most</dt>
                  <dd className="selectable m-0 text-right font-mono">{fee.maxFee ? `${fee.maxFee} ${fee.feeAsset}` : 'not read yet'}</dd>
                </div>
              ))}
              <dd className="col-span-2 m-0 text-[var(--ot-text-3)]">Each part’s fee comes from the account that sends it. Most of each comes back.</dd>
            </dl>
          ) : null}
          <p className="m-0 text-[13px] text-[var(--ot-text-2)]" hidden={Boolean(plan.stepFees)}>
            {plan.maxFee ? (
              <>
                + up to <strong className="selectable">
                  {plan.maxFee} {plan.feeAsset}
                </strong>{' '}
                network fee
              </>
            ) : (
              `Ink couldn’t read today’s fee. Approve asks ${plan.chain} again and shows the maximum, and nothing is signed until you approve that.`
            )}
          </p>
          {plan.maxTotal ? (
            <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-dashed border-[var(--ot-border)] pt-2 text-[11.5px]">
              <dt className="text-[var(--ot-text-3)]">{plan.asset !== plan.feeAsset ? `Most ${plan.feeAsset} that can leave your account` : 'Most that can leave'}</dt>
              <dd className="selectable m-0 text-right font-mono">
                {plan.maxTotal} {plan.feeAsset}
              </dd>
              <dt className="text-[var(--ot-text-3)]">Network fee, at most</dt>
              <dd className={feeRose ? 'selectable m-0 rounded-md bg-[var(--ot-warn-bg)] px-1.5 text-right font-mono font-bold text-[var(--ot-warn-text)]' : 'selectable m-0 text-right font-mono'}>
                {feeRose ? <s className="mr-1 font-medium text-[var(--ot-text-3)]">{feeRose}</s> : null}
                {plan.maxFee} {plan.feeAsset}
              </dd>
              <dd className="col-span-2 m-0 text-[var(--ot-text-3)]">
                Most of the fee comes back.
                {plan.swap?.from === 'wallet' ? ' It also counts registering with wNEAR, refunded where you or the deposit address already are.' : ''}
              </dd>
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
                  <span className="selectable text-[13.5px] font-bold [overflow-wrap:anywhere]">
                    {plan.actions.length === 1 ? '1 action · ' : `${index + 1} of ${plan.actions.length} · `}
                    {action.summary}
                  </span>
                  <span className="text-[12px] text-[var(--ot-text-3)]">
                    {action.method ? `Calls ${action.method}, attaching ${action.amount} ${plan.feeAsset}.` : `${action.kind} of ${action.amount} ${plan.feeAsset}. Calls no contract.`}
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
            <Detail label="Fee">{plan.maxFee ? `Up to ${plan.maxFee} ${plan.feeAsset}` : 'Not known yet'}</Detail>
            <Detail label="From">
              <Address value={plan.from} small />
            </Detail>
            <Detail label="Signing key">{plan.publicKey}</Detail>
            <Detail label="Exact amount">
              {plan.amountYocto} {plan.asset === 'NEAR' && plan.chain === 'NEAR' ? 'yoctoNEAR' : `in ${plan.asset}’s smallest unit`}
            </Detail>
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
                <a className="selectable font-mono [overflow-wrap:anywhere]" href={`${plan.explorer.tx}${state.transactionId}`} target="_blank" rel="noreferrer">
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

/**
 * A payment, as NEAR Intents' quotes fixed it: each part brings exactly its amount into the
 * Intents balance, then one payout sends exactly the total to the recipient, in one
 * transfer. Ink signs the payout now and sends it once the parts have landed.
 */
function PayTerms({ legs, payout, to, on }: { legs: readonly ReviewLeg[]; payout: NonNullable<ReviewPlan['payout']>; to: string; on: string }) {
  return (
    <Section label="How it’s paid, through NEAR Intents" card>
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {payout.fromBalance ? (
          <li className="border-b border-dashed border-[var(--ot-border)] pb-2.5 text-[13.5px]">
            <strong className="selectable font-mono">{payout.fromBalance}</strong> <span className="text-[var(--ot-text-2)]">already in your NEAR Intents balance</span>
          </li>
        ) : null}
        {legs.map((leg, index) => (
          <li key={index} className="flex flex-col gap-1 border-b border-dashed border-[var(--ot-border)] pb-2.5">
            <span className="text-[13.5px]">
              <strong className="selectable font-mono">{leg.send}</strong> <span className="text-[var(--ot-text-2)]">from {leg.fromPlace}</span>
              <span className="text-[var(--ot-text-3)]"> → exactly </span>
              <strong className="selectable font-mono">{leg.get}</strong>
              <span className="text-[var(--ot-text-2)]"> into your NEAR Intents balance</span>
            </span>
            <span className="text-[12px] text-[var(--ot-text-3)]">
              NEAR Intents’ {leg.fee} fee is included. Anything it doesn’t need goes back {leg.from === 'intents' ? 'into your NEAR Intents balance' : `to ${leg.refundTo}`}.
            </span>
            <Address value={leg.depositAddress} small />
          </li>
        ))}
        <li className="flex flex-col gap-1">
          <span className="text-[13.5px]">
            <span className="text-[var(--ot-text-2)]">Then </span>
            <strong className="selectable font-mono">exactly {payout.get}</strong>
            <span className="text-[var(--ot-text-2)]"> to </span>
            <span className="selectable font-mono [overflow-wrap:anywhere]">{to}</span>
            <span className="text-[var(--ot-text-2)]"> on {on}, in one transfer</span>
          </span>
          <span className="text-[12px] text-[var(--ot-text-3)]">
            Signed now with the rest, and sent by Ink once every part has landed. NEAR Intents’ {payout.fee} fee is included; anything left over stays in your NEAR Intents balance.
          </span>
        </li>
      </ol>
    </Section>
  )
}

/** Where a swap pays out, in a phrase: "on Base", "in your NEAR Intents balance". */
const landsIn = (swap: ReviewSwap) => (swap.getChain.startsWith('your ') ? `in ${swap.getChain}` : `on ${swap.getChain}`)

/**
 * A swap's terms, as NEAR Intents' quote fixed them: what goes in and comes out, who it
 * pays and refunds, and where the deposit goes.
 */
function SwapTerms({ plan, swap }: { plan: ReviewPlan; swap: ReviewSwap }) {
  const closes = new Date(swap.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <Section label="Swap through NEAR Intents" card>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
        <dt className="text-[var(--ot-text-3)]">You send</dt>
        <dd className="selectable m-0 font-mono font-bold">{swap.send}</dd>
        <dt className="text-[var(--ot-text-3)]">You get about</dt>
        <dd className="selectable m-0 font-mono font-bold">
          {swap.get} <span className="font-sans font-normal text-[var(--ot-text-2)]">{landsIn(swap)}</span>
        </dd>
        <dt className="text-[var(--ot-text-3)]">At least</dt>
        <dd className="selectable m-0 font-mono">
          {swap.least} <span className="font-sans text-[var(--ot-text-2)]">or it’s refunded</span>
        </dd>
      </dl>
      <div className="flex flex-col gap-1 border-t border-dashed border-[var(--ot-border)] pt-2">
        <span className="ink-eyebrow">Paid to</span>
        <Address value={plan.to} />
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="ok">
            <CheckIcon size={12} />
            {plan.toWhy === 'typed'
              ? 'You typed this address in the chat'
              : plan.toKind === 'other-chain'
                ? `Your own address on ${swap.getChain}`
                : 'Your own NEAR Intents balance'}
          </Badge>
        </div>
        {plan.toWhy === 'typed' ? (
          <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">
            Not your own address. Check every character against the address you meant, and that it’s on {swap.getChain}. A payout to the wrong address can’t be taken back.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <span className="ink-eyebrow">Refunds go to</span>
        <Address value={swap.refundTo} small />
        <span className="text-[12px] text-[var(--ot-text-3)]">
          {swap.from === 'intents' ? 'Back into your NEAR Intents balance' : swap.from === 'evm' || swap.from === 'solana' ? `Back to the address it came from, on ${plan.chain}` : 'Your own NEAR account'}, if the swap can’t pay at
          least the amount above.
        </span>
      </div>
      <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">
        NEAR Intents’ {swap.fee} fee is already taken out. It should take about {swap.seconds} seconds once the deposit lands.
      </p>
      <details className="ink-review-details">
        <summary>The deposit address</summary>
        <Address value={swap.depositAddress} small />
        <p className="m-0 pt-1 text-[12px] text-[var(--ot-text-3)]">NEAR Intents’ address for this swap only. It closes at {closes}; Ink won’t send to it after that.</p>
      </details>
    </Section>
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
