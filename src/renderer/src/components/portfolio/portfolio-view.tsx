import { useState } from 'react'
import { ACCOUNT_CHAINS, type AccountChain } from '../../../../shared/accounts'
import type { Portfolio } from '../../../../shared/portfolio'
import { Otto } from '@/components/brand/otto'
import { Ring } from '@/components/motion/ring'
import { Sea } from '@/components/motion/sea'
import { ReceiveIcon, RefreshIcon } from '@/components/shell/icons'
import { Badge, Button, ChainLogo, ChainStack, Callout, TokenLogo } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatMoney, formatMoneyFlat, formatShare } from '@/lib/format'
import { ACCOUNT_CHAIN_MARK, isTokenSymbol } from '@/lib/logos'
import { portfolioFailure, portfolioView, readAgo, shareBar, type PortfolioRow } from '@/lib/portfolio'
import { useNow, usePortfolio } from '@/lib/use-portfolio'

/** The chain chips, by short name. */
const CHAIN_NAMES: Record<AccountChain, string> = { near: 'NEAR', evm: 'EVM', solana: 'Solana', bitcoin: 'Bitcoin', tron: 'Tron', sui: 'Sui', aptos: 'Aptos' }

/** Chains whose balances Ink reads so far. */
const READ: readonly AccountChain[] = ['near']

const NOT_READ = ACCOUNT_CHAINS.filter((chain) => !READ.includes(chain))

const COLUMNS = 'grid-cols-[minmax(170px,2fr)_minmax(104px,1.2fr)_minmax(88px,1fr)_minmax(84px,.8fr)_auto]'

type Filter = 'all' | AccountChain

/** A token's mark: its own for the few Ink has, otherwise its letters. Never NEAR's mark on a token that isn't NEAR. */
function RowLogo({ row, size = 'md' }: { row: PortfolioRow; size?: 'sm' | 'md' }) {
  return <TokenLogo symbol={row.symbol} chain={isTokenSymbol(row.symbol) ? 'near' : null} size={size} />
}

function Money({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[var(--ot-text-3)]">—</span>
  if (value > 0 && value < 0.01) return <>under $0.01</>
  return <>{formatMoneyFlat(value)}</>
}

function Row({ row, onAsk, onReceive, muted = false }: { row: PortfolioRow; onAsk: (text: string) => void; onReceive: () => void; muted?: boolean }) {
  const name = row.id === 'near-staked' ? 'staked NEAR' : row.symbol
  return (
    <div className={cn('grid items-center gap-2.5 border-b border-[var(--ot-border)] px-4 py-[11px] last:border-b-0', COLUMNS)}>
      <span className="flex min-w-0 items-center gap-2.5">
        <RowLogo row={row} />
        <span className="min-w-0">
          <b className="block truncate text-[14px]">{row.symbol}</b>
          <span className="block truncate text-[12px] text-[var(--ot-text-3)]" title={row.contract ?? undefined}>
            {row.label}
          </span>
        </span>
      </span>
      <span className="text-right font-mono text-[13px] font-semibold" title={`${row.exact} ${row.symbol}`}>
        {row.amount}
      </span>
      <span className="flex flex-col items-end text-right font-mono text-[13px]">
        <Money value={row.usd} />
        {row.thin ? (
          <span className="font-sans text-[11px] text-[var(--ot-warn-text)]" title="Its market is too thin to sell this much near the price, so the total counts what a sale would fetch.">
            counts {formatMoneyFlat(row.counted)}
          </span>
        ) : null}
      </span>
      <span className="flex items-center justify-end gap-1.5">
        {muted || row.share === null ? (
          <span className="text-[11.5px] text-[var(--ot-text-3)]">{muted ? 'Not counted' : '—'}</span>
        ) : (
          <>
            <span className="h-1.5 w-11 overflow-hidden rounded-full bg-[var(--ot-water-2)]" aria-hidden>
              <span className="block h-full" style={{ width: `${Math.min(100, row.share * 100)}%`, background: row.color }} />
            </span>
            <span className="w-[38px] text-right font-mono text-[11.5px] text-[var(--ot-text-3)]">{formatShare(row.share)}</span>
          </>
        )}
      </span>
      <span className="flex justify-end gap-1">
        <button type="button" className="ink-suggestion h-[30px] gap-1.5 pr-2.5 pl-1 text-[12px]" onClick={() => onAsk(`Tell me about my ${name}${row.contract ? ` (contract ${row.contract})` : ''}.`)}>
          <RowLogo row={row} size="sm" />
          Ask about {row.symbol}
        </button>
        <Button size="sm" variant="ghost" aria-label={`Receive ${row.symbol}`} className="px-2" onClick={onReceive}>
          <ReceiveIcon size={15} />
        </Button>
      </span>
    </div>
  )
}

function Total({ portfolio, rows }: { portfolio: Portfolio; rows: PortfolioRow[] }) {
  const bar = shareBar(rows)
  const money = portfolio.totalUsd === null ? null : formatMoney(portfolio.totalUsd)
  return (
    <section className="ink-review-card ink-review-card--stk relative min-w-0 flex-[2_1_420px] px-5 py-[18px]" aria-label="Total">
      <span className="pointer-events-none absolute -top-9 right-3.5">
        <Otto pose="planning" size={104} animated label="Otto counting coins" />
      </span>
      <span className="ink-eyebrow">Everything you hold</span>
      <div className="mt-1.5 mb-3 flex flex-wrap items-baseline gap-2.5">
        {money ? (
          <span className="font-mono text-[40px] font-bold tracking-[-0.03em]">
            {money.whole}
            <span className="text-[var(--ot-text-3)]">.{money.fraction}</span>
          </span>
        ) : (
          <span className="font-mono text-[40px] font-bold tracking-[-0.03em] text-[var(--ot-text-3)]">$—</span>
        )}
        <span className="text-[12.5px] text-[var(--ot-text-3)]">{money ? 'On NEAR so far · one recovery phrase' : 'Prices couldn’t be read, so there’s no total'}</span>
      </div>
      {bar.length > 0 ? (
        <>
          <div
            className="flex h-3.5 gap-[3px] overflow-hidden rounded-full border-2 border-[var(--ot-navy)]"
            role="img"
            aria-label={bar.map((part) => `${part.label} ${formatShare(part.share)}`).join(', ')}
          >
            {bar.map((part) => (
              <span key={part.label} style={{ flex: part.share, background: part.color }} />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-3 text-[12px] text-[var(--ot-text-2)]" aria-hidden>
            {bar.map((part) => (
              <span key={part.label} className="flex items-center gap-[5px]">
                <span className="size-2.5 rounded-full" style={{ background: part.color }} />
                {part.label} {formatShare(part.share)}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}

function Gaps({ portfolio, stale }: { portfolio: Portfolio; stale: boolean }) {
  const lines = [
    ...(stale ? ['Ink couldn’t read your balances just now, so these are from before.'] : []),
    ...(portfolio.gaps.includes('tokens') ? ['The list of your tokens couldn’t be read, so some may be missing.'] : []),
    ...(portfolio.gaps.includes('prices') ? ['Prices couldn’t be read, so there are no dollar values.'] : []),
    ...(portfolio.gaps.includes('reviews') ? ['Some tokens couldn’t be checked, so they aren’t counted.'] : []),
    ...(portfolio.near.stakingComplete ? [] : ['Some staking pools couldn’t be read, so staked NEAR may be higher.']),
  ]
  if (lines.length === 0) return null
  return (
    <Callout severity="caution" title="Some figures may be short" compact>
      {lines.join(' ')}
    </Callout>
  )
}

export interface PortfolioViewProps {
  /** Starts a chat about something here, with the words in the composer. */
  onAsk: (text: string) => void
  /** Opens Receive, on a chain when one is given. */
  onReceive: (chain?: AccountChain) => void
}

/**
 * Everything the wallet holds, read in main from each chain's own services. NEAR so
 * far: native, staked and every token with a price. Tokens nobody vouches for are
 * shown apart and never counted; the rest are only counted.
 */
export function PortfolioView({ onAsk, onReceive }: PortfolioViewProps) {
  const { result, reading, stale, refresh } = usePortfolio()
  const now = useNow()
  const [filter, setFilter] = useState<Filter>('all')
  const view = result?.ok ? portfolioView(result) : null
  const showRows = filter === 'all' || filter === 'near'

  return (
    <main className="ink-panel" id="main">
      <Sea shafts={false} />
      <div className="ink-panel__scroll px-7 pt-[26px] pb-7">
        <div className="mx-auto flex max-w-[960px] flex-col gap-4">
          <div className="flex items-center gap-3">
            <h1 className="m-0 flex-1 font-display text-[28px] font-bold tracking-[-0.02em]">Portfolio</h1>
            <Button size="sm" variant="secondary" onClick={refresh} disabled={reading}>
              {reading ? <Ring size={13} label="Reading balances" /> : <RefreshIcon size={14} />}
              Refresh
            </Button>
          </div>

          {result === null ? (
            <section className="ink-review-card flex items-center gap-3 px-5 py-6 text-[14px] text-[var(--ot-text-2)]" aria-busy>
              <Ring size={16} label="Reading balances" />
              Reading your balances from NEAR…
            </section>
          ) : !result.ok ? (
            <Callout severity="block" title="No balances" compact>
              {portfolioFailure(result)}
            </Callout>
          ) : view ? (
            <>
              <Gaps portfolio={result} stale={stale} />
              <div className="flex flex-wrap items-stretch gap-3.5 pt-5">
                <Total portfolio={result} rows={view.rows} />
                <section className="ink-glance flex-[1_1_220px] gap-2 p-4" aria-label="Ask your agent">
                  <span className="ink-eyebrow">Ask your agent</span>
                  <button type="button" className="ink-suggestion h-9 pl-1 text-[12.5px]" onClick={() => onAsk('Send some NEAR')}>
                    <TokenLogo symbol="NEAR" size="sm" />
                    Send some NEAR
                  </button>
                  <button type="button" className="ink-suggestion h-9 pl-1 text-[12.5px]" onClick={() => onAsk('Quote USDC to NEAR')}>
                    <span className="ink-logo-stack" aria-hidden>
                      <TokenLogo symbol="USDC" size="sm" />
                      <TokenLogo symbol="NEAR" size="sm" />
                    </span>
                    Quote USDC to NEAR
                  </button>
                  <Button variant="secondary" className="mt-auto" onClick={() => onReceive()}>
                    <ReceiveIcon size={15} />
                    Receive
                  </Button>
                </section>
              </div>

              <div role="group" aria-label="Filter by chain" className="flex flex-wrap gap-1.5">
                {(['all', ...ACCOUNT_CHAINS] as const).map((chain) => (
                  <button
                    key={chain}
                    type="button"
                    className={cn('ink-pill h-[34px] text-[12.5px]', chain === 'all' ? 'px-3' : 'pr-3 pl-[5px]', filter === chain && 'ink-pill--on')}
                    aria-pressed={filter === chain}
                    onClick={() => setFilter(chain)}
                  >
                    {chain === 'all' ? null : <ChainLogo chain={ACCOUNT_CHAIN_MARK[chain]} size="sm" />}
                    {chain === 'all' ? 'All chains' : CHAIN_NAMES[chain]}
                  </button>
                ))}
              </div>

              <section className="ink-review-card overflow-hidden p-0" aria-label="Assets">
                <div className="overflow-x-auto">
                  <div className="min-w-[640px]">
                    <div
                      hidden={!showRows}
                      className={cn(
                        'grid gap-2.5 border-b-[1.5px] border-[var(--ot-border)] px-4 py-2.5 text-[11px] font-bold tracking-[0.06em] text-[var(--ot-text-3)] uppercase',
                        COLUMNS,
                      )}
                      aria-hidden
                    >
                      <span>Asset</span>
                      <span className="text-right">Balance</span>
                      <span className="text-right">Value</span>
                      <span className="text-right">Share</span>
                      <span className="w-[150px]" />
                    </div>
                    {showRows ? view.rows.map((row) => <Row key={row.id} row={row} onAsk={onAsk} onReceive={() => onReceive('near')} />) : null}
                    {showRows && view.unreviewed.length > 0 ? (
                      <details className="border-t border-[var(--ot-border)]">
                        <summary className="flex cursor-pointer items-center gap-2 bg-[var(--ot-surface-2)] px-4 py-2.5 text-[12.5px] text-[var(--ot-text-2)]">
                          <Badge tone="warn">Unverified</Badge>
                          {view.unreviewed.length === 1 ? '1 token' : `${view.unreviewed.length} tokens`} nobody vouches for. Not counted: anyone can make a token and a price for it.
                        </summary>
                        {view.unreviewed.map((row) => (
                          <Row key={row.id} row={row} onAsk={onAsk} onReceive={() => onReceive('near')} muted />
                        ))}
                      </details>
                    ) : null}
                    {showRows && view.unpriced > 0 ? (
                      <p className="m-0 border-t border-[var(--ot-border)] px-4 py-2.5 text-[12px] text-[var(--ot-text-3)]">
                        {view.unpriced === 1 ? '1 more token has' : `${view.unpriced} more tokens have`} no price or {view.unpriced === 1 ? 'is' : 'are'} marked as spam, so{' '}
                        {view.unpriced === 1 ? 'it isn’t' : 'they aren’t'} shown.
                      </p>
                    ) : null}
                    {filter === 'all' ? (
                      <div className="flex items-center gap-3 border-t border-[var(--ot-border)] bg-[var(--ot-surface-2)] px-4 py-3">
                        <ChainStack chains={NOT_READ.map((chain) => ACCOUNT_CHAIN_MARK[chain])} />
                        <span className="flex-1 text-[12.5px] text-[var(--ot-text-3)]">Ink reads NEAR so far. EVM, Solana, Bitcoin and the rest come next.</span>
                        <Button size="sm" variant="secondary" onClick={() => onReceive()}>
                          Your addresses
                        </Button>
                      </div>
                    ) : null}
                    {filter !== 'all' && !READ.includes(filter) ? (
                      <div className="flex flex-col items-center gap-2.5 px-4 py-7 text-center">
                        <Otto pose="base" size={80} animated label="Otto" />
                        <b>Ink doesn’t read {CHAIN_NAMES[filter]} balances yet</b>
                        <Button variant="primary" onClick={() => onReceive(filter)}>
                          Get your {CHAIN_NAMES[filter]} address
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              <p className="m-0 flex flex-wrap items-center gap-2 text-[12px] text-[var(--ot-text-3)]">
                {reading ? <Ring size={12} label="Reading balances" /> : null}
                {reading ? 'Reading again · ' : ''}Balances read {readAgo(result.readAt, now)} from NEAR’s RPC and FastNEAR, prices and reviews from Intear. They see your NEAR address.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </main>
  )
}
