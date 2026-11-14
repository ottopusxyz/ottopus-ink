import type { ReviewAction, ReviewPlan, ReviewTransaction } from '../../../shared/review'
import { ArrowRightIcon, ClockIcon } from '@/components/shell/icons'
import { Badge } from '@/components/ui'
import { ChainMark } from '@/components/wallet/chain-mark'
import { Signed, Token } from './money-map'
import { shortAddress } from './review-copy'

/** A contract method, as a small tag. */
function Method({ name }: { name: string }) {
  return <span className="rounded-md bg-[var(--ot-surface-3)] px-1.5 py-px font-mono text-[11px] text-[var(--ot-text-2)]">{name}</span>
}

/** A summary for a row, with each long address cut to its ends. The whole summary is under "Exactly what's signed". */
const shortWords = (text: string) => text.replace(/[0-9A-Za-z._-]{24,}/g, (word) => shortAddress(word))

/** One action's row: what it moves and to whom, then where that is and the method it calls. A call that moves nothing says what it does. */
function ActionRow({ action }: { action: ReviewAction }) {
  const move = action.move
  if (!move) {
    return (
      <li className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 text-[12.5px] [overflow-wrap:anywhere] text-[var(--ot-text-2)]">{shortWords(action.summary)}</span>
        {action.method ? <Method name={action.method} /> : null}
      </li>
    )
  }
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5">
      <span className="row-span-2">
        <Token amount={move} size="sm" />
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <Signed sign="-" amount={move.amount} symbol={move.token.symbol} />
        <ArrowRightIcon size={12} />
        <span className="selectable truncate font-mono text-[12px]" title={move.to}>
          {shortAddress(move.to)}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--ot-text-3)]">
        {move.role === 'deposit' ? <span className="text-[var(--ot-plan-text)]">NEAR Intents’ deposit address</span> : <span>the recipient</span>}
        {action.method ? <Method name={action.method} /> : null}
      </span>
    </li>
  )
}

/** Where, when and how one transaction runs: its chain, the key that signs it, and whether Ink sends it now. */
function TransactionCard({ tx, index, count, payout }: { tx: ReviewTransaction; index: number; count: number; payout: ReviewPlan['flow']['in'] | null }) {
  const later = tx.when === 'later'
  return (
    <li className={`ink-review-card flex flex-col gap-2 py-3 ${later ? 'border-dashed' : ''}`}>
      <div className="flex items-center gap-2">
        <ChainMark chain={tx.chain} size="sm" />
        <span className="text-[13.5px] font-bold">{tx.chain.name}</span>
        <span className="text-[11.5px] text-[var(--ot-text-3)]">
          {count > 1 ? `${index + 1} of ${count} · ` : ''}
          {tx.key}
        </span>
        <span className="flex-1" />
        {later ? (
          <Badge tone="warn">
            <ClockIcon size={11} />
            After the parts land
          </Badge>
        ) : (
          <Badge tone="plan">Sent on approval</Badge>
        )}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {tx.actions.map((action, i) => (
          <ActionRow key={i} action={action} />
        ))}
        {later && payout ? (
          <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 border-t border-dashed border-[var(--ot-border)] pt-1.5">
            <span className="row-span-2">
              <Token amount={payout} size="sm" />
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <Signed sign="+" amount={payout.amount} symbol={payout.token.symbol} />
              <ArrowRightIcon size={12} />
              <span className="selectable truncate font-mono text-[12px]" title={payout.to}>
                {shortAddress(payout.to)}
              </span>
            </span>
            <span className="text-[11px] text-[var(--ot-ok-text)]">NEAR Intents pays it out on {payout.token.place}</span>
          </li>
        ) : null}
      </ul>
      <details className="ink-review-details">
        <summary>Exactly what’s signed</summary>
        <ol className="m-0 flex list-decimal flex-col gap-1.5 pt-1 pl-4 text-[12px] text-[var(--ot-text-2)]">
          {tx.actions.map((action, i) => (
            <li key={i}>
              <span className="selectable [overflow-wrap:anywhere]">{action.summary}.</span>{' '}
              <span className="text-[var(--ot-text-3)]">
                {action.method ? `Calls ${action.method}, attaching ${action.amount} ${action.attachAsset}.` : `A transfer of ${action.amount} ${action.attachAsset}. Calls no contract.`}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </li>
  )
}

/** Each transaction the person signs, grouped by chain and in the order Ink sends them. */
export function Transactions({ plan }: { plan: ReviewPlan }) {
  const count = plan.transactions.length
  return (
    <section className="flex flex-col gap-2" aria-label="What you sign">
      <h2 className="ink-eyebrow m-0">What you sign · {count === 1 ? 'one transaction' : `${count} transactions`}</h2>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {plan.transactions.map((tx, index) => (
          <TransactionCard key={index} tx={tx} index={index} count={count} payout={plan.kind === 'pay' ? plan.flow.in : null} />
        ))}
      </ol>
    </section>
  )
}

/**
 * Fees and limits: each transaction's network fee at most, beside its chain, and for a plan
 * with one transaction the most of its coin that can leave the account. A fee that rose is
 * shown beside the one struck through.
 */
export function Fees({ plan, feeRose }: { plan: ReviewPlan; feeRose: string | null }) {
  const one = plan.transactions.length === 1
  return (
    <section className="ink-review-card flex flex-col gap-2" aria-label="Fees">
      <h2 className="ink-eyebrow m-0">Fees, at most</h2>
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-[12.5px]">
        {plan.swap ? (
          <div className="contents">
            <dt className="text-[var(--ot-text-2)]">NEAR Intents’ fee, already out of what you get</dt>
            <dd className="m-0 text-right font-mono text-[var(--ot-text-3)]">{plan.swap.fee}</dd>
          </div>
        ) : null}
        {plan.legs && plan.payout ? (
          <div className="contents">
            <dt className="text-[var(--ot-text-2)]">NEAR Intents’ fee, already in the parts</dt>
            <dd className="m-0 text-right font-mono text-[var(--ot-text-3)]">
              {[...new Set(plan.legs.map((leg) => leg.fee))].join(', ')} · payout {plan.payout.fee}
            </dd>
          </div>
        ) : null}
        {plan.transactions.map((tx, index) => {
          const rose = one && feeRose && tx.maxFee
          return (
            <div key={index} className="contents">
              <dt className="flex items-center gap-1.5 text-[var(--ot-text-2)]">
                <ChainMark chain={tx.chain} size="xs" />
                Network fee on {tx.chain.name}
              </dt>
              <dd className={`selectable m-0 text-right font-mono ${rose ? 'rounded-md bg-[var(--ot-warn-bg)] px-1.5 font-bold text-[var(--ot-warn-text)]' : 'text-[var(--ot-text-3)]'}`}>
                {rose ? <s className="mr-1 font-medium text-[var(--ot-text-3)]">{feeRose}</s> : null}
                {tx.maxFee ? `− ${tx.maxFee} ${tx.feeAsset}` : 'not read yet'}
              </dd>
            </div>
          )
        })}
        {plan.maxTotal ? (
          <div className="contents">
            <dt className="font-semibold text-[var(--ot-text)]">{plan.asset !== plan.feeAsset ? `Most ${plan.feeAsset} that can leave your account` : 'Most that can leave your account'}</dt>
            <dd className="selectable m-0 text-right font-mono font-bold text-[var(--ot-block-text)]">
              − {plan.maxTotal} {plan.feeAsset}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="m-0 text-[11.5px] text-[var(--ot-text-3)]">
        {plan.transactions.some((tx) => !tx.maxFee)
          ? `Ink couldn’t read every fee yet. Approve asks again and shows the maximum, and nothing is signed until you approve that.`
          : one
            ? 'Most of the fee comes back.'
            : 'Each fee comes from the account that sends it. Most of each comes back.'}
        {plan.swap?.from === 'wallet' ? ' It also counts registering with wNEAR, refunded where you or the deposit address already are.' : ''}
        {plan.kind === 'pay' ? ' Anything a part doesn’t use goes back where it came from.' : ''}
      </p>
    </section>
  )
}
