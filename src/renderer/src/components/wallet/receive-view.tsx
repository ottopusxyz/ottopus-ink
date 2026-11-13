import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AccountChain } from '../../../../shared/accounts'
import type { ReceiveAnswer, ReceiveChain, ReceiveToken } from '../../../../shared/ipc'
import { Otto } from '@/components/brand/otto'
import { Sea } from '@/components/motion/sea'
import { CheckIcon, CopyIcon, SearchIcon } from '@/components/shell/icons'
import { Callout, ChainLogo, Input, IntentsLogo, TokenLogo } from '@/components/ui'
import { cn } from '@/lib/cn'
import { isChainId } from '@/lib/logos'
import { addressParts } from '@/lib/wallet'
import { QrCode } from './qr-code'

/** Chains shown before any search. */
const SHOWN_CHAINS = 5

/** The receive chain a wallet account opens on, as when Portfolio asks for one chain's address. */
const START: Record<AccountChain, string> = { near: 'near', evm: 'ethereum', solana: 'solana', bitcoin: 'bitcoin', tron: 'tron', sui: 'sui', aptos: 'aptos' }

type Chains = { kind: 'loading' } | { kind: 'ready'; chains: ReceiveChain[] } | { kind: 'failed' }

/** A chain's mark: Ink's own where it has one, else its initial. */
function ChainMark({ chain, size = 'md' }: { chain: Pick<ReceiveChain, 'mark' | 'name'>; size?: 'sm' | 'md' | 'lg' }) {
  if (chain.mark && isChainId(chain.mark)) return <ChainLogo chain={chain.mark} size={size} />
  if (chain.mark === 'ton' || chain.mark === 'xrp') return <IntentsLogo chain={chain.mark} size={size} />
  return (
    <span className={cn('ink-logo ink-logo--text', `ink-logo--${size}`)} aria-hidden>
      {chain.name.slice(0, 1)}
    </span>
  )
}

/** A search box with its matches dropped down under it. */
function SearchBox<T>({
  label,
  placeholder,
  results,
  render,
  onPick,
  onQuery,
}: {
  label: string
  placeholder: string
  results: readonly T[]
  render: (item: T) => ReactNode
  onPick: (item: T) => void
  onQuery: (query: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  return (
    <div className="relative max-w-[360px]" onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setOpen(false)}>
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--ot-text-3)]">
        <SearchIcon size={14} />
      </span>
      <Input
        aria-label={label}
        placeholder={placeholder}
        className="pl-8"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          onQuery(event.target.value)
        }}
      />
      {open && query.trim() ? (
        <ul role="listbox" aria-label={label} className="ink-review-card absolute top-full z-10 m-0 mt-1 flex max-h-[260px] w-full list-none flex-col gap-0.5 overflow-auto p-1">
          {results.length === 0 ? (
            <li className="px-2 py-1.5 text-[12.5px] text-[var(--ot-text-3)]">No matches</li>
          ) : (
            results.map((item, index) => (
              <li key={index}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left hover:bg-[var(--ot-surface-2)]"
                  // Keeps focus in the search box, so the list stays open until the pick lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onPick(item)
                    setQuery('')
                    setOpen(false)
                  }}
                >
                  {render(item)}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Receiving into the wallet from any chain, NEAR Intents first: pick the chain and the
 * token, optionally say how much, and Ink shows the one address to use. Main picks it:
 * NEAR Intents' deposit address where it takes the token and the amount, so what arrives
 * lands in the Intents balance, else the wallet's own address on that chain. Each card
 * says which it is. Only reachable while unlocked.
 */
export function ReceiveView({ startChain = null }: { /** The chain to open on, as when Portfolio asks for one chain's address. */ startChain?: AccountChain | null } = {}) {
  const [chains, setChains] = useState<Chains>({ kind: 'loading' })
  const [chainId, setChainId] = useState<string>(startChain ? START[startChain] : 'near')
  const [picked, setPicked] = useState<ReceiveToken | null>(null)
  const [amount, setAmount] = useState('')
  const [found, setFound] = useState<ReceiveToken[]>([])
  const searchAsked = useRef(0)

  useEffect(() => {
    let live = true
    window.ink.receiveChains().then(
      (list) => live && setChains(list.length > 0 ? { kind: 'ready', chains: list } : { kind: 'failed' }),
      () => live && setChains({ kind: 'failed' }),
    )
    return () => {
      live = false
    }
  }, [])

  const list = useMemo(() => (chains.kind === 'ready' ? chains.chains : []), [chains])
  const chain = list.find((item) => item.id === chainId) ?? list[0]
  const token = picked ?? chain?.tokens[0] ?? null
  const shown = useMemo(() => {
    const top = list.slice(0, SHOWN_CHAINS)
    // A chain picked from the search joins the row, so it shows as chosen.
    return chain && !top.includes(chain) ? [...top, chain] : top
  }, [list, chain])
  const tokens = token && chain && !chain.tokens.some((each) => each.symbol === token.symbol) ? [...chain.tokens, token] : (chain?.tokens ?? [])

  const pickChain = (id: string) => {
    setChainId(id)
    setPicked(null)
    setAmount('')
    setFound([])
  }

  const searchTokens = (query: string) => {
    const ask = ++searchAsked.current
    if (!chain || !query.trim()) {
      setFound([])
      return
    }
    window.ink.searchReceiveTokens(chain.id, query.trim()).then(
      (results) => ask === searchAsked.current && setFound(results),
      () => ask === searchAsked.current && setFound([]),
    )
  }

  return (
    <main className="ink-panel" id="main">
      <Sea shafts={false} />
      <div className="ink-panel__scroll flex flex-col gap-5 px-7 py-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-[28px] font-bold tracking-[-0.02em]">Receive</h1>
          <p className="m-0 max-w-[62ch] text-[14px] leading-[1.55] text-[var(--ot-text-2)]">
            Pick the chain and what’s coming. Ink shows the one address to use: NEAR Intents’ where it takes it, so it lands in your Intents balance, else your own.
          </p>
        </div>
        {chains.kind === 'loading' ? (
          <p className="m-0 text-[14px] text-[var(--ot-text-3)]">Working out where you can receive…</p>
        ) : chains.kind === 'failed' || !chain || !token ? (
          <Callout severity="block" title="Nowhere to receive yet" compact className="max-w-[720px]">
            Ink couldn’t list the chains to receive on. Try again in a moment.
          </Callout>
        ) : (
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-5">
              <section aria-labelledby="receive-chain" className="flex flex-col gap-2.5">
                <h2 id="receive-chain" className="ink-step">
                  <span className="ink-step__n">1</span>Which chain?
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5">
                  {shown.map((item) => (
                    <button key={item.id} type="button" className={cn('ink-choice', item.id === chain.id && 'ink-choice--on')} aria-pressed={item.id === chain.id} onClick={() => pickChain(item.id)}>
                      <ChainMark chain={item} />
                      <span className="flex min-w-0 flex-col text-left">
                        <span className="text-[13px] font-bold">{item.name}</span>
                        <span className="truncate text-[11.5px] text-[var(--ot-text-3)]">{item.intents ? 'NEAR Intents' : 'Your own address'}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <ChainSearch chains={list} onPick={(item) => pickChain(item.id)} />
              </section>

              <section aria-labelledby="receive-asset" className="flex flex-col gap-2.5">
                <h2 id="receive-asset" className="ink-step">
                  <span className="ink-step__n">2</span>What are you receiving?
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {tokens.map((item) => (
                    <button
                      key={item.symbol}
                      type="button"
                      className={cn('ink-choice', item.symbol === token.symbol && 'ink-choice--on')}
                      aria-pressed={item.symbol === token.symbol}
                      onClick={() => {
                        setPicked(item)
                        setAmount('')
                      }}
                    >
                      <TokenLogo symbol={item.symbol} size="md" />
                      <span className="flex min-w-0 flex-col text-left">
                        <span className="text-[13px] font-bold">{item.symbol}</span>
                        <span className="text-[11.5px] text-[var(--ot-text-3)]">{item.min ? `at least ${item.min}` : 'to your own address'}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <TokenSearch key={chain.id} chainName={chain.name} found={found} onQuery={searchTokens} onPick={(item) => setPicked(item)} />
              </section>

              {token.intents ? (
                <section aria-labelledby="receive-amount" className="flex flex-col gap-2.5">
                  <h2 id="receive-amount" className="ink-step">
                    <span className="ink-step__n">3</span>How much? <span className="font-normal text-[var(--ot-text-3)]">Optional</span>
                  </h2>
                  <div className="flex max-w-[360px] items-center gap-2">
                    <Input aria-label={`How much ${token.symbol}`} inputMode="decimal" placeholder={`At least ${token.min ?? '0'} for NEAR Intents`} value={amount} onChange={(event) => setAmount(event.target.value.trim())} mono />
                    <span className="text-[13px] font-semibold">{token.symbol}</span>
                  </div>
                  <p className="m-0 text-[12px] text-[var(--ot-text-3)]">
                    Under {token.min} {token.symbol}, NEAR Intents doesn’t credit it{chain.own ? ', so Ink gives your own address instead' : ''}.
                  </p>
                </section>
              ) : null}
            </div>

            <ReceiveCard chain={chain} asset={token.symbol} amount={token.intents && /^[0-9]+(\.[0-9]+)?$/.test(amount) ? amount : null} />
          </div>
        )}
      </div>
    </main>
  )
}

/** Every chain by name, for the ones past the first few. */
function ChainSearch({ chains, onPick }: { chains: readonly ReceiveChain[]; onPick: (chain: ReceiveChain) => void }) {
  const [query, setQuery] = useState('')
  const matches = chains.filter((chain) => chain.name.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <SearchBox
      label="Search chains"
      placeholder={`Search all ${chains.length} chains`}
      results={matches}
      onQuery={setQuery}
      render={(item) => (
        <>
          <ChainMark chain={item} size="sm" />
          <span className="flex-1 text-[13px] font-semibold">{item.name}</span>
          <span className="text-[11px] text-[var(--ot-text-3)]">{item.intents ? 'NEAR Intents' : 'Your own address'}</span>
        </>
      )}
      onPick={onPick}
    />
  )
}

/** The token search, which asks main as the person types: NEAR Intents' tokens, then Zerion's. */
function TokenSearch({ chainName, found, onQuery, onPick }: { chainName: string; found: readonly ReceiveToken[]; onQuery: (query: string) => void; onPick: (token: ReceiveToken) => void }) {
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <SearchBox
      label={`Search tokens on ${chainName}`}
      placeholder={`Search tokens on ${chainName}`}
      results={found}
      onQuery={(query) => {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => onQuery(query), 300)
      }}
      render={(item) => (
        <>
          <TokenLogo symbol={item.symbol} size="sm" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13px] font-semibold">{item.symbol}</span>
            {item.name ? <span className="truncate text-[11.5px] text-[var(--ot-text-3)]">{item.name}</span> : null}
          </span>
          <span className="text-[11px] text-[var(--ot-text-3)]">{item.intents ? `NEAR Intents · at least ${item.min}` : 'Your own address'}</span>
        </>
      )}
      onPick={onPick}
    />
  )
}

type Answer = { kind: 'loading' } | { kind: 'ready'; answer: ReceiveAnswer; for: string }

/** The address main picked, with whose it is, its QR code, any memo, and what to send. */
function ReceiveCard({ chain, asset, amount }: { chain: ReceiveChain; asset: string; amount: string | null }) {
  const [state, setState] = useState<Answer>({ kind: 'loading' })
  const [copied, setCopied] = useState<'none' | 'address' | 'memo' | 'failed'>('none')
  const timer = useRef<number | undefined>(undefined)
  const ask = useMemo(() => ({ chain: chain.id, asset, amount }), [chain.id, asset, amount])
  const key = `${ask.chain} ${ask.asset} ${ask.amount ?? ''}`

  useEffect(() => {
    let live = true
    // Waits a moment while an amount is typed, so each keystroke doesn't ask.
    const wait = window.setTimeout(() => {
      window.ink.receiveAddress(ask).then(
        (answer) => live && setState({ kind: 'ready', answer, for: key }),
        () => live && setState({ kind: 'ready', answer: { ok: false, reason: 'unavailable' }, for: key }),
      )
    }, 250)
    return () => {
      live = false
      window.clearTimeout(wait)
    }
  }, [ask, key])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async (part: 'address' | 'memo') => {
    const result = await window.ink.copyReceive(ask, part).catch(() => ({ ok: false }))
    setCopied(result.ok ? part : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied('none'), 2000)
  }

  if (state.kind === 'loading') {
    return (
      <section className="ink-address-card min-h-[420px]" aria-busy>
        <p className="m-0 text-[13px] text-[var(--ot-text-3)]">Working out the address…</p>
      </section>
    )
  }
  const { answer } = state
  // The last answer stays up, dimmed, until the one for what's picked now arrives, so the card doesn't jump.
  const stale = state.for !== key
  if (!answer.ok) {
    const text =
      answer.reason === 'locked'
        ? 'Unlock Ink to see where to receive.'
        : answer.reason === 'below-minimum'
          ? `NEAR Intents credits at least ${answer.min} ${asset} on ${chain.name}, and you have no address of your own there. Send at least that.`
          : answer.reason === 'not-supported'
            ? `Neither NEAR Intents nor your own accounts take ${asset} on ${chain.name}.`
            : 'Ink couldn’t work out an address right now. Try again in a moment.'
    return (
      <section className={cn('ink-address-card', stale && 'opacity-50')} aria-busy={stale}>
        <Callout severity="block" title={answer.reason === 'locked' ? 'Ink is locked' : 'No address for this'} compact>
          {text}
        </Callout>
      </section>
    )
  }

  const intents = answer.kind === 'intents'
  const { start, middle, end } = addressParts(answer.address)
  const ownNote =
    answer.kind === 'own'
      ? answer.why === 'below-minimum'
        ? `That’s under the ${answer.min} ${answer.asset} NEAR Intents credits, so this is your own address.`
        : answer.why === 'intents-unavailable'
          ? 'NEAR Intents couldn’t be reached, so this is your own address.'
          : `NEAR Intents doesn’t take ${answer.asset} on ${answer.chainName}, so this is your own address.`
      : null
  return (
    <section aria-label={intents ? `Your NEAR Intents deposit address on ${answer.chainName}` : `Your ${answer.chainName} address`} className={cn('ink-address-card transition-opacity', stale && 'opacity-50')} aria-busy={stale}>
      <Otto pose="base" size={70} animated className="ink-address-card__otto" />
      <div className="flex items-center gap-2.5">
        <TokenLogo symbol={answer.asset} size="md" />
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold">{intents ? `Deposit ${answer.asset} into NEAR Intents` : `Receive ${answer.asset}`}</div>
          <div className="text-[12px] text-[var(--ot-text-3)]">sent on {answer.chainName}</div>
        </div>
      </div>

      <div className="ink-qr-frame">
        <QrCode value={answer.address} label={`QR code for the address to receive ${answer.asset} on ${answer.chainName}`} size={216} />
        <span className="ink-qr-frame__mark">
          <ChainMark chain={chain} size="lg" />
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="ink-eyebrow">{intents ? 'NEAR Intents deposit address · not your own' : `Your ${answer.chainName} address`}</span>
        <p className="ink-address selectable m-0" data-address>
          <strong>{start}</strong>
          {middle}
          <strong>{end}</strong>
        </p>
        <p className="m-0 text-[12px] leading-[1.45] text-[var(--ot-text-3)]">After scanning or pasting, check that the first and last six characters match the highlighted ones.</p>
      </div>

      {answer.kind === 'intents' && answer.memo ? (
        <div className="flex flex-col gap-1 rounded-[12px] border-2 border-[var(--ot-warn-border)] bg-[var(--ot-warn-bg)] px-3 py-2">
          <span className="ink-eyebrow text-[var(--ot-warn-text)]">Memo, required</span>
          <span className="selectable font-mono text-[16px] font-bold">{answer.memo}</span>
          <span className="text-[12px] text-[var(--ot-warn-text)]">Without this memo, NEAR Intents can’t tell the deposit is yours, and it isn’t credited.</span>
        </div>
      ) : null}

      <div className="ink-address-card__warn">
        <strong>
          Send only {answer.asset} on {answer.chainName} here{answer.kind === 'intents' ? `, at least ${answer.min} ${answer.asset}` : ''}
        </strong>
        <span>
          {answer.kind === 'intents'
            ? 'Less isn’t credited. This address belongs to the NEAR Intents bridge, not to your recovery phrase: what arrives is credited to your Intents balance, and shows under In Intents in Portfolio.'
            : ownNote}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ink-copy" disabled={stale} onClick={() => void copy('address')} aria-label={`Copy the address to receive ${answer.asset} on ${answer.chainName}`}>
          {copied === 'address' ? <CheckIcon /> : <CopyIcon />}
          {copied === 'address' ? 'Copied' : copied === 'failed' ? 'Couldn’t copy' : 'Copy address'}
        </button>
        {answer.kind === 'intents' && answer.memo ? (
          <button type="button" className="ink-copy" disabled={stale} onClick={() => void copy('memo')} aria-label="Copy the memo">
            {copied === 'memo' ? <CheckIcon /> : <CopyIcon />}
            {copied === 'memo' ? 'Copied' : 'Copy memo'}
          </button>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2 text-[11.5px] text-[var(--ot-text-3)]">
        {answer.kind === 'intents' ? (
          <>
            <span>Credited to NEAR account</span>
            <span className="font-mono">
              {answer.account.slice(0, 6)}…{answer.account.slice(-6)}
            </span>
          </>
        ) : (
          <>
            <span className="font-mono">{answer.path}</span>
            <span>from your one recovery phrase</span>
          </>
        )}
      </div>
    </section>
  )
}
