import type { ReviewAmount, ReviewPlan } from '../../../shared/review'
import { ArrowRightIcon } from '@/components/shell/icons'
import { ChainLogo, TokenLogo } from '@/components/ui'
import { ChainMark } from '@/components/wallet/chain-mark'
import { chainColour, shortAddress, shortAmount } from './review-copy'

/**
 * A signed amount: red for what leaves, green for what arrives. Where it's narrow the
 * symbol drops below the number rather than running out of its box. The exact amount is
 * its title, and in the details.
 */
export function Signed({ sign, amount, symbol, size = 'md' }: { sign: '-' | '+'; amount: string; symbol?: string; size?: 'md' | 'lg' }) {
  const { text, cut } = shortAmount(amount)
  return (
    <span
      className={`selectable inline-flex min-w-0 flex-wrap items-baseline gap-x-[0.35em] font-mono leading-[1.2] font-bold ${size === 'lg' ? 'text-[18px]' : 'text-[13.5px]'} ${sign === '-' ? 'text-[var(--ot-block-text)]' : 'text-[var(--ot-ok-text)]'}`}
      title={`${sign === '-' ? '−' : '+'} ${amount}${symbol ? ` ${symbol}` : ''}`}
    >
      <span className="whitespace-nowrap">
        {sign === '-' ? '−' : '+'} {cut ? '≈' : ''}
        {text}
      </span>
      {symbol ? <span className="whitespace-nowrap">{symbol}</span> : null}
    </span>
  )
}

/** A token's logo with its chain's badge, from Ink's own logos or Zerion's icon. */
export function Token({ amount, size = 'md' }: { amount: Pick<ReviewAmount, 'token'>; size?: 'sm' | 'md' | 'lg' }) {
  const { token } = amount
  return <TokenLogo symbol={token.symbol} chain={token.chain} icon={token.icon} size={size} label={`${token.symbol} on ${token.place}`} />
}

/** What the map's heading says for each kind of plan. */
function headingOf(plan: ReviewPlan): string {
  if (plan.kind === 'pay') return `How it’s paid · ${plan.flow.out.length} ${plan.flow.out.length === 1 ? 'part' : 'parts'}, one approval`
  return plan.kind === 'swap' ? 'What you swap' : 'What you send'
}

/**
 * The money map: each source that leaves the wallet or the NEAR Intents balance, in red,
 * through NEAR Intents when it carries or swaps it, to what arrives where, in green. A
 * payment adds a bar of what each source brings to the total, in its chain's colour.
 */
export function MoneyMap({ plan }: { plan: ReviewPlan }) {
  const { flow } = plan
  const arrives = flow.in
  const pay = plan.kind === 'pay'
  const total = flow.out.reduce((sum, each) => sum + Number(each.brings ?? 0), 0)
  return (
    <section className="ink-review-card flex flex-col gap-3" aria-label={headingOf(plan)}>
      <h2 className="ink-eyebrow m-0">{headingOf(plan)}</h2>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,0.9fr)] items-center gap-2">
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {flow.out.map((source, index) => (
            <li key={index} className="flex min-w-0 items-center gap-2.5">
              <span className="flex-none">
                <Token amount={source} />
              </span>
              <span className="flex min-w-0 flex-col">
                <Signed sign="-" amount={source.amount} symbol={source.token.symbol} />
                <span className="truncate text-[11.5px] text-[var(--ot-text-3)]">{source.token.place}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col items-center gap-1 text-[var(--ot-text-4)]" aria-hidden>
          <ArrowRightIcon size={14} />
          {flow.via === 'intents' ? (
            <>
              <span className="rounded-full p-[3px] ring-1 ring-[var(--ot-plan-border)]">
                <ChainLogo chain="near" size="sm" />
              </span>
              <span className="text-[10px] font-bold text-[var(--ot-plan-text)]">Intents</span>
              <ArrowRightIcon size={14} />
            </>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 rounded-[12px] bg-[var(--ot-ok-bg)] px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex-none">
              <Token amount={arrives} />
            </span>
            <Signed sign="+" amount={arrives.amount} symbol={arrives.token.symbol} size={pay ? 'lg' : 'md'} />
          </span>
          <span className="text-[11.5px] text-[var(--ot-ok-text)]">
            {arrives.exact ? 'exactly, ' : arrives.least ? `at least ${shortAmount(arrives.least).text}, ` : ''}
            {arrives.token.place === 'NEAR Intents' ? 'into NEAR Intents' : `on ${arrives.token.place}`}
          </span>
          <span className="selectable truncate font-mono text-[11.5px] text-[var(--ot-ok-text)]" title={arrives.to}>
            {shortAddress(arrives.to)}
          </span>
        </div>
      </div>

      {pay && total > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="What each source brings to the total">
            {flow.out.map((source, index) => (
              <span key={index} style={{ flex: Number(source.brings ?? 0), background: chainColour(source.token.chain) }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {flow.out.map((source, index) => (
              <span key={index} className="flex items-center gap-1.5 text-[11.5px] text-[var(--ot-text-2)]">
                <span className="inline-block size-2 rounded-[2px]" style={{ background: chainColour(source.token.chain) }} aria-hidden />
                <ChainMark chain={{ mark: source.token.chain, name: source.token.place }} size="xs" />
                <span className="selectable font-mono">{shortAmount(source.brings ?? '0').text}</span> from {source.token.place}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
