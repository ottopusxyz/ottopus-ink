import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AccountChain } from '../../../../shared/accounts'
import type { ReceiveAnswer, ReceiveChain, ReceiveToken } from '../../../../shared/ipc'
import { Otto } from '@/components/brand/otto'
import { Ring } from '@/components/motion/ring'
import { Sea } from '@/components/motion/sea'
import { CheckIcon, CloseIcon, CopyIcon, SearchIcon } from '@/components/shell/icons'
import { Callout, Input, TokenLogo } from '@/components/ui'
import { cn } from '@/lib/cn'
import { isTokenSymbol } from '@/lib/logos'
import { receiveCacheOfApp } from '@/lib/receive-cache'
import { addressParts } from '@/lib/wallet'
import { ChainMark } from './chain-mark'
import { QrCode } from './qr-code'

/** Chains shown before any search. */
const SHOWN_CHAINS = 5

/** The receive chain a wallet account opens on, as when Portfolio asks for one chain's address. */
const START: Record<AccountChain, string> = { near: 'near', evm: 'ethereum', solana: 'solana', bitcoin: 'bitcoin', tron: 'tron', sui: 'sui', aptos: 'aptos' }

type Chains = { kind: 'loading' } | { kind: 'ready'; chains: ReceiveChain[] } | { kind: 'failed' }

/** A minimum worth showing: one too small to matter, such as wNEAR's one yoctoNEAR, reads as none. */
function minOf(min: string | null): string | null {
  return min && !/^0\.0{8}/.test(min) ? min : null
}

/**
 * Icons for the tiles Ink has no mark of its own for, found by searching each symbol on
 * the chain. Searches are cached, so a chain's tiles are looked up once a while.
 */
function useTileIcons(chainId: string | undefined, tokens: readonly ReceiveToken[]): (token: ReceiveToken) => string | null {
  const cache = receiveCacheOfApp()
  const [icons, setIcons] = useState<Record<string, string>>({})
  const wanted = tokens
    .filter((token) => !token.icon && !isTokenSymbol(token.symbol))
    .map((token) => token.symbol)
    .join(' ')
  useEffect(() => {
    if (!chainId || !wanted) return
    let live = true
    for (const symbol of wanted.split(' ')) {
      cache.loadSearch(chainId, symbol).then(
        (found) => {
          const icon = found.find((token) => token.symbol.toLowerCase() === symbol.toLowerCase())?.icon
          if (live && icon) setIcons((now) => ({ ...now, [`${chainId} ${symbol}`]: icon }))
        },
        () => undefined,
      )
    }
    return () => {
      live = false
    }
  }, [cache, chainId, wanted])
  return (token) => token.icon ?? icons[`${chainId} ${token.symbol}`] ?? null
}

/** A placeholder shaped like what's loading. */
function Bone({ className }: { className?: string }) {
  return <span className={cn('ink-skeleton', className)} aria-hidden />
}

/**
 * A search field with its matches dropped down under it, like the sidebar's search.
 * Arrow keys move through the matches, Enter picks one, Escape clears. `busy` shows
 * the tentacle ring while an answer is on its way.
 */
function SearchBox<T>({
  label,
  placeholder,
  results,
  busy = false,
  empty = 'No matches',
  keyOf,
  render,
  onPick,
  onQuery,
}: {
  label: string
  placeholder: string
  results: readonly T[]
  busy?: boolean
  empty?: string
  keyOf: (item: T) => string
  render: (item: T) => ReactNode
  onPick: (item: T) => void
  onQuery: (query: string) => void
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const shown = open && query.trim() !== ''
  const at = Math.min(active, results.length - 1)

  const change = (text: string) => {
    setQuery(text)
    setActive(0)
    setOpen(true)
    onQuery(text)
  }
  const pick = (item: T) => {
    onPick(item)
    change('')
    setOpen(false)
  }

  return (
    <div className="ink-finder" onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setOpen(false)}>
      <label className={cn('ink-search ink-finder__field', shown && 'ink-finder__field--open')}>
        <SearchIcon size={14} />
        <span className="sr-only">{label}</span>
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={shown}
          aria-controls={`${id}-list`}
          aria-activedescendant={shown && at >= 0 ? `${id}-${at}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              if (results.length > 0) setActive((at + step + results.length) % results.length)
            } else if (event.key === 'Enter' && shown && results[at]) {
              event.preventDefault()
              pick(results[at])
            } else if (event.key === 'Escape' && query) {
              event.preventDefault()
              change('')
            }
          }}
        />
        {busy ? <Ring size={14} label="Searching" /> : null}
        {query && !busy ? (
          <button
            type="button"
            className="ink-finder__clear"
            aria-label="Clear the search"
            onClick={() => {
              change('')
              input.current?.focus()
            }}
          >
            <CloseIcon size={12} />
          </button>
        ) : null}
      </label>
      {shown ? (
        <ul id={`${id}-list`} role="listbox" aria-label={label} className="ink-finder__list">
          {results.length === 0 ? (
            <li className="ink-finder__empty">{busy ? 'Searching…' : empty}</li>
          ) : (
            results.map((item, index) => (
              <li
                key={keyOf(item)}
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === at}
                className="ink-finder__option"
                // Keeps focus in the field, so the list stays open until the pick lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => index !== at && setActive(index)}
                onClick={() => pick(item)}
              >
                {render(item)}
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
 * lands in the Intents balance, else the wallet's own address on that chain. The card
 * says which it is. Only reachable while unlocked.
 */
export function ReceiveView({ startChain = null }: { /** The chain to open on: a wallet account's, as when Portfolio asks, or Ink's name for one, as a deposit card does. */ startChain?: string | null } = {}) {
  const cache = receiveCacheOfApp()
  const [chains, setChains] = useState<Chains>(() => {
    const kept = cache.chains()
    return kept ? { kind: 'ready', chains: kept } : { kind: 'loading' }
  })
  const [chainId, setChainId] = useState<string>(startChain ? (START[startChain as AccountChain] ?? startChain) : 'near')
  const [picked, setPicked] = useState<ReceiveToken | null>(null)
  const [amount, setAmount] = useState('')

  useEffect(() => {
    let live = true
    // Shown from the cache at once when there is one; this only refreshes it when stale.
    cache.loadChains().then(
      (list) => live && setChains((now) => (list.length > 0 ? { kind: 'ready', chains: list } : now.kind === 'ready' ? now : { kind: 'failed' })),
      () => live && setChains((now) => (now.kind === 'ready' ? now : { kind: 'failed' })),
    )
    return () => {
      live = false
    }
  }, [cache])

  const list = useMemo(() => (chains.kind === 'ready' ? chains.chains : []), [chains])
  const chain = list.find((item) => item.id === chainId) ?? list[0]
  const token = picked ?? chain?.tokens[0] ?? null
  const shown = useMemo(() => {
    const top = list.slice(0, SHOWN_CHAINS)
    // A chain picked from the search joins the row, so it shows as chosen.
    return chain && !top.includes(chain) ? [...top, chain] : top
  }, [list, chain])
  const tokens = token && chain && !chain.tokens.some((each) => each.symbol === token.symbol) ? [...chain.tokens, token] : (chain?.tokens ?? [])
  const iconOf = useTileIcons(chain?.id, tokens)

  const pickChain = (id: string) => {
    setChainId(id)
    setPicked(null)
    setAmount('')
  }

  return (
    <main className="ink-panel" id="main">
      <Sea shafts={false} />
      <div className="ink-panel__scroll flex flex-col gap-5 px-7 py-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-[28px] font-bold tracking-[-0.02em]">Receive</h1>
          <p className="m-0 max-w-[62ch] text-[14px] leading-[1.55] text-[var(--ot-text-2)]">Pick the chain and what’s coming, and Ink shows the one address to use. Where NEAR Intents takes it, it lands in your Intents balance.</p>
        </div>
        {chains.kind === 'loading' ? (
          <ReceiveSkeleton />
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
                <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-1.5">
                  {shown.map((item) => (
                    <button key={item.id} type="button" className={cn('ink-choice', item.id === chain.id && 'ink-choice--on')} aria-pressed={item.id === chain.id} onClick={() => pickChain(item.id)}>
                      <ChainMark chain={item} />
                      <span className="truncate text-[13px] font-bold">{item.name}</span>
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
                      <TokenLogo symbol={item.symbol} icon={iconOf(item)} size="md" />
                      <span className="flex min-w-0 flex-col text-left">
                        <span className="text-[13px] font-bold">{item.symbol}</span>
                        {minOf(item.min) ? <span className="text-[11.5px] text-[var(--ot-text-3)]">min {item.min}</span> : null}
                      </span>
                    </button>
                  ))}
                </div>
                <TokenSearch key={chain.id} chain={chain} onPick={(item) => setPicked(item)} />
              </section>

              {token.intents && minOf(token.min) ? (
                <section aria-labelledby="receive-amount" className="flex flex-col gap-2.5">
                  <h2 id="receive-amount" className="ink-step">
                    <span className="ink-step__n">3</span>How much? <span className="font-normal text-[var(--ot-text-3)]">Optional</span>
                  </h2>
                  <div className="flex max-w-[360px] items-center gap-2">
                    <Input aria-label={`How much ${token.symbol}`} inputMode="decimal" placeholder={`${token.min ?? '0'} or more`} value={amount} onChange={(event) => setAmount(event.target.value.trim())} mono />
                    <span className="text-[13px] font-semibold">{token.symbol}</span>
                  </div>
                  <p className="m-0 text-[12px] text-[var(--ot-text-3)]">{chain.own ? `Under ${token.min} ${token.symbol}, Ink gives your own address instead.` : `Under ${token.min} ${token.symbol} isn’t credited.`}</p>
                </section>
              ) : null}
            </div>

            <ReceiveCard chain={chain} asset={token.symbol} icon={iconOf(token)} amount={token.intents && /^[0-9]+(\.[0-9]+)?$/.test(amount) ? amount : null} />
          </div>
        )}
      </div>
    </main>
  )
}

/** The screen's shape while the chains are first listed. */
function ReceiveSkeleton() {
  return (
    <div className="flex flex-wrap items-start gap-5" role="status" aria-label="Listing the chains to receive on">
      <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-5">
        {[5, 4].map((count, step) => (
          <div key={step} className="flex flex-col gap-2.5">
            <Bone className="h-5 w-40" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-1.5">
              {Array.from({ length: count }, (_, i) => (
                <Bone key={i} className="h-[50px] rounded-[13px]" />
              ))}
            </div>
            <Bone className="h-[34px] max-w-[360px] rounded-[9px]" />
          </div>
        ))}
      </div>
      <CardSkeleton />
    </div>
  )
}

/** The address card's shape while its address is worked out. */
function CardSkeleton() {
  return (
    <section className="ink-address-card" aria-busy role="status" aria-label="Working out the address">
      <div className="flex items-center gap-2.5">
        <Bone className="ink-skeleton--round size-8 shrink-0" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Bone className="h-4 w-36" />
          <Bone className="h-3 w-24" />
        </div>
      </div>
      <Bone className="size-[240px] self-center rounded-[18px]" />
      <div className="flex flex-col gap-1.5">
        <Bone className="h-3 w-28" />
        <Bone className="h-[46px] w-full rounded-[12px]" />
      </div>
      <Bone className="h-[58px] w-full rounded-[12px]" />
      <Bone className="ink-skeleton--round h-9 w-36" />
    </section>
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
      keyOf={(item) => item.id}
      onQuery={setQuery}
      render={(item) => (
        <>
          <ChainMark chain={item} size="sm" />
          <span className="flex-1 text-[13px] font-semibold">{item.name}</span>
        </>
      )}
      onPick={onPick}
    />
  )
}

type Search = { query: string; tokens: ReceiveToken[]; busy: boolean }

/**
 * The token search, which asks main as the person types: NEAR Intents' tokens first, then
 * Zerion's. A search asked before answers at once from the cache.
 */
function TokenSearch({ chain, onPick }: { chain: ReceiveChain; onPick: (token: ReceiveToken) => void }) {
  const cache = receiveCacheOfApp()
  const [search, setSearch] = useState<Search>({ query: '', tokens: [], busy: false })
  const timer = useRef<number | undefined>(undefined)
  const asked = useRef('')
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const ask = (text: string) => {
    const query = text.trim()
    asked.current = query
    window.clearTimeout(timer.current)
    if (!query) return setSearch({ query, tokens: [], busy: false })
    const kept = cache.search(chain.id, query)
    if (kept) return setSearch({ query, tokens: kept, busy: false })
    // Keeps what's shown and still matches while the next answer comes, so the list doesn't flicker.
    const wanted = query.toLowerCase()
    setSearch((now) => ({ query, tokens: now.tokens.filter((token) => `${token.symbol} ${token.name ?? ''}`.toLowerCase().includes(wanted)), busy: true }))
    timer.current = window.setTimeout(() => {
      cache.loadSearch(chain.id, query).then(
        (tokens) => asked.current === query && setSearch({ query, tokens, busy: false }),
        () => asked.current === query && setSearch({ query, tokens: [], busy: false }),
      )
    }, 250)
  }

  return (
    <SearchBox
      label={`Search tokens on ${chain.name}`}
      placeholder={`Search tokens on ${chain.name}`}
      results={search.tokens}
      busy={search.busy}
      empty={`No tokens on ${chain.name} match`}
      keyOf={(item) => item.symbol}
      onQuery={ask}
      render={(item) => (
        <>
          <TokenLogo symbol={item.symbol} icon={item.icon} size="sm" />
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="text-[13px] font-semibold">{item.symbol}</span>
            {item.name && item.name.toLowerCase() !== item.symbol.toLowerCase() ? <span className="truncate text-[12px] text-[var(--ot-text-3)]">{item.name}</span> : null}
          </span>
          {minOf(item.min) ? <span className="shrink-0 font-mono text-[11px] text-[var(--ot-text-3)]">min {item.min}</span> : null}
        </>
      )}
      onPick={onPick}
    />
  )
}

type Answer = { kind: 'loading' } | { kind: 'ready'; answer: ReceiveAnswer; for: string; chain: ReceiveChain }

/** The address main picked, with whose it is, its QR code, any memo, and what to send. */
function ReceiveCard({ chain, asset, icon, amount }: { chain: ReceiveChain; asset: string; icon: string | null; amount: string | null }) {
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
        (answer) => live && setState({ kind: 'ready', answer, for: key, chain }),
        () => live && setState({ kind: 'ready', answer: { ok: false, reason: 'unavailable' }, for: key, chain }),
      )
    }, 250)
    return () => {
      live = false
      window.clearTimeout(wait)
    }
  }, [ask, key, chain])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async (part: 'address' | 'memo') => {
    const result = await window.ink.copyReceive(ask, part).catch(() => ({ ok: false }))
    setCopied(result.ok ? part : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied('none'), 2000)
  }

  if (state.kind === 'loading') return <CardSkeleton />
  const { answer } = state
  // The last answer stays up, dimmed, until the one for what's picked now arrives, so the card doesn't jump.
  const stale = state.for !== key
  const updating = stale ? (
    <span className="ink-address-card__updating">
      <Ring size={12} tone="plan" />
      Updating
    </span>
  ) : null
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
      <section className="ink-address-card" aria-busy={stale}>
        {updating ? <div className="flex justify-end">{updating}</div> : null}
        <div className={cn('transition-opacity', stale && 'opacity-50')}>
          <Callout severity="block" title={answer.reason === 'locked' ? 'Ink is locked' : 'No address for this'} compact>
            {text}
          </Callout>
        </div>
      </section>
    )
  }

  const intents = answer.kind === 'intents'
  const { start, middle, end } = addressParts(answer.address)
  const ownNote =
    answer.kind === 'own'
      ? answer.why === 'below-minimum'
        ? `That’s under NEAR Intents’ ${answer.min} ${answer.asset} minimum, so this is your own address.`
        : answer.why === 'intents-unavailable'
          ? 'NEAR Intents couldn’t be reached, so this is your own address.'
          : null
      : null
  return (
    <section aria-label={intents ? `Your NEAR Intents deposit address on ${answer.chainName}` : `Your ${answer.chainName} address`} className="ink-address-card" aria-busy={stale}>
      <Otto pose="base" size={70} animated className="ink-address-card__otto" />
      <div className="flex items-center gap-2.5">
        <div className={cn('flex min-w-0 flex-1 items-center gap-2.5 transition-opacity', stale && 'opacity-50')}>
          <TokenLogo symbol={answer.asset} icon={answer.asset === asset ? icon : null} size="md" />
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold">Receive {answer.asset}</div>
            <div className="text-[12px] text-[var(--ot-text-3)]">
              on {answer.chainName}
              {intents ? ' · into your Intents balance' : ''}
            </div>
          </div>
        </div>
        {updating}
      </div>
      <div className={cn('flex flex-col gap-[14px] transition-opacity', stale && 'opacity-50')}>
        <div className="ink-qr-frame">
          <QrCode value={answer.address} label={`QR code for the address to receive ${answer.asset} on ${answer.chainName}`} size={216} />
          <span className="ink-qr-frame__mark">
            {/* The chain the shown address is on, which may not be the one just picked. */}
            <ChainMark chain={state.chain} size="lg" />
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="ink-eyebrow">{intents ? 'NEAR Intents deposit address' : `Your ${answer.chainName} address`}</span>
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
            <span className="text-[12px] text-[var(--ot-warn-text)]">Without it, the deposit can’t be matched to you and isn’t credited.</span>
          </div>
        ) : null}

        <div className="ink-address-card__warn">
          <strong>
            Send only {answer.asset} on {answer.chainName} here{answer.kind === 'intents' && minOf(answer.min) ? `, at least ${answer.min}` : ''}
          </strong>
          {answer.kind === 'intents' ? <span>{minOf(answer.min) ? 'Less isn’t credited. ' : ''}The address isn’t from your recovery phrase; what arrives shows under In Intents in Portfolio.</span> : ownNote ? <span>{ownNote}</span> : null}
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
      </div>
    </section>
  )
}
