import { useEffect, useRef, useState } from 'react'
import type { IntentsDepositChain, IntentsDepositResult } from '../../../../shared/ipc'
import { Otto } from '@/components/brand/otto'
import { CheckIcon, CopyIcon } from '@/components/shell/icons'
import { Callout, ChainLogo, IntentsLogo, TokenLogo } from '@/components/ui'
import { cn } from '@/lib/cn'
import { isChainId } from '@/lib/logos'
import { addressParts } from '@/lib/wallet'
import { QrCode } from './qr-code'

type Chains = { kind: 'loading' } | { kind: 'ready'; chains: IntentsDepositChain[] } | { kind: 'failed' }

/** A chain's mark: Ink's own where it has one, else its initial. */
function ChainMark({ chain, size = 'md' }: { chain: IntentsDepositChain; size?: 'md' | 'lg' }) {
  if (chain.mark && isChainId(chain.mark)) return <ChainLogo chain={chain.mark} size={size} />
  if (chain.mark === 'ton' || chain.mark === 'xrp') return <IntentsLogo chain={chain.mark} size={size} />
  return (
    <span className={cn('ink-logo ink-logo--text', `ink-logo--${size}`)} aria-hidden>
      {chain.name.slice(0, 1)}
    </span>
  )
}

/**
 * Depositing into the NEAR Intents balance from any chain the bridge serves: pick the
 * chain and the token, and Ink shows the address the bridge keeps for this wallet there,
 * with the memo a chain needs and the least it credits. It's the bridge's address, not
 * one from the recovery phrase, and says so.
 */
export function IntentsDeposit() {
  const [chains, setChains] = useState<Chains>({ kind: 'loading' })
  const [picked, setPicked] = useState<string | null>(null)
  const [symbol, setSymbol] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    window.ink.intentsDepositChains().then(
      (list) => live && setChains(list && list.length > 0 ? { kind: 'ready', chains: list } : { kind: 'failed' }),
      () => live && setChains({ kind: 'failed' }),
    )
    return () => {
      live = false
    }
  }, [])

  if (chains.kind === 'loading') return <p className="m-0 text-[14px] text-[var(--ot-text-3)]">Asking NEAR Intents which chains it takes…</p>
  if (chains.kind === 'failed') {
    return (
      <Callout severity="block" title="NEAR Intents couldn’t be reached" compact className="max-w-[720px]">
        Ink couldn’t read which chains NEAR Intents takes deposits on. Try again in a moment.
      </Callout>
    )
  }
  const chain = chains.chains.find((item) => item.key === picked) ?? chains.chains[0]!
  const token = chain.tokens.find((item) => item.symbol === symbol) ?? chain.tokens[0]!

  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-5">
        <section aria-labelledby="deposit-chain" className="flex flex-col gap-2.5">
          <h2 id="deposit-chain" className="ink-step">
            <span className="ink-step__n">2</span>Which chain is it sent from?
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5">
            {chains.chains.map((item) => (
              <button
                key={item.key}
                type="button"
                className={cn('ink-choice', item.key === chain.key && 'ink-choice--on')}
                aria-pressed={item.key === chain.key}
                onClick={() => {
                  setPicked(item.key)
                  setSymbol(null)
                }}
              >
                <ChainMark chain={item} />
                <span className="flex min-w-0 flex-col text-left">
                  <span className="text-[13px] font-bold">{item.name}</span>
                  <span className="truncate text-[11.5px] text-[var(--ot-text-3)]">{item.tokens.map((each) => each.symbol).slice(0, 3).join(', ')}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
        <section aria-labelledby="deposit-token" className="flex flex-col gap-2.5">
          <h2 id="deposit-token" className="ink-step">
            <span className="ink-step__n">3</span>What are you sending?
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {chain.tokens.map((item) => (
              <button
                key={item.symbol}
                type="button"
                className={cn('ink-choice', item.symbol === token.symbol && 'ink-choice--on')}
                aria-pressed={item.symbol === token.symbol}
                onClick={() => setSymbol(item.symbol)}
              >
                <TokenLogo symbol={item.symbol} size="md" />
                <span className="flex min-w-0 flex-col text-left">
                  <span className="text-[13px] font-bold">{item.symbol}</span>
                  <span className="text-[11.5px] text-[var(--ot-text-3)]">at least {item.min}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
      <DepositCard key={chain.key} chain={chain} token={token} />
    </div>
  )
}

type Address = { kind: 'loading' } | { kind: 'ready'; found: Extract<IntentsDepositResult, { ok: true }> } | { kind: 'failed'; locked: boolean }

function DepositCard({ chain, token }: { chain: IntentsDepositChain; token: { symbol: string; min: string } }) {
  const [address, setAddress] = useState<Address>({ kind: 'loading' })
  const [copied, setCopied] = useState<'none' | 'address' | 'memo' | 'failed'>('none')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let live = true
    window.ink.intentsDepositAddress(chain.key).then(
      (found) => live && setAddress(found.ok ? { kind: 'ready', found } : { kind: 'failed', locked: found.reason === 'locked' }),
      () => live && setAddress({ kind: 'failed', locked: false }),
    )
    return () => {
      live = false
      window.clearTimeout(timer.current)
    }
  }, [chain.key])

  const copy = async (part: 'address' | 'memo') => {
    const result = await window.ink.copyIntentsDeposit(chain.key, part).catch(() => ({ ok: false }))
    setCopied(result.ok ? part : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied('none'), 2000)
  }

  return (
    <section aria-label={`Your NEAR Intents deposit address on ${chain.name}`} className="ink-address-card">
      <Otto pose="base" size={70} animated className="ink-address-card__otto" />
      <div className="flex items-center gap-2.5">
        <TokenLogo symbol={token.symbol} size="md" />
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold">Deposit {token.symbol} into NEAR Intents</div>
          <div className="text-[12px] text-[var(--ot-text-3)]">sent on {chain.name}</div>
        </div>
      </div>

      {address.kind === 'loading' ? (
        <p className="m-0 text-[13px] text-[var(--ot-text-3)]">Asking NEAR Intents for your address…</p>
      ) : address.kind === 'failed' ? (
        <Callout severity="block" title={address.locked ? 'Ink is locked' : 'No address yet'} compact>
          {address.locked ? 'Unlock Ink to see your deposit address.' : 'NEAR Intents didn’t give an address for this chain. Try again in a moment.'}
        </Callout>
      ) : (
        <>
          <div className="ink-qr-frame">
            <QrCode value={address.found.address} label={`QR code for your NEAR Intents deposit address on ${chain.name}`} size={216} />
            <span className="ink-qr-frame__mark">
              <ChainMark chain={chain} size="lg" />
            </span>
          </div>
          <DepositAddress text={address.found.address} />
          {address.found.memo ? (
            <div className="flex flex-col gap-1 rounded-[12px] border-2 border-[var(--ot-warn-border)] bg-[var(--ot-warn-bg)] px-3 py-2">
              <span className="ink-eyebrow text-[var(--ot-warn-text)]">Memo, required</span>
              <span className="selectable font-mono text-[16px] font-bold">{address.found.memo}</span>
              <span className="text-[12px] text-[var(--ot-warn-text)]">Without this memo, NEAR Intents can’t tell the deposit is yours, and it isn’t credited.</span>
            </div>
          ) : null}
          <div className="ink-address-card__warn">
            <strong>
              Send only {token.symbol} on {chain.name} here, at least {token.min} {token.symbol}
            </strong>
            <span>
              Less isn’t credited. This address belongs to the NEAR Intents bridge, not to your recovery phrase: what arrives is credited to your Intents balance, and shows under In Intents in Portfolio.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ink-copy" onClick={() => void copy('address')} aria-label={`Copy your NEAR Intents deposit address on ${chain.name}`}>
              {copied === 'address' ? <CheckIcon /> : <CopyIcon />}
              {copied === 'address' ? 'Copied' : copied === 'failed' ? 'Couldn’t copy' : 'Copy address'}
            </button>
            {address.found.memo ? (
              <button type="button" className="ink-copy" onClick={() => void copy('memo')} aria-label="Copy the memo">
                {copied === 'memo' ? <CheckIcon /> : <CopyIcon />}
                {copied === 'memo' ? 'Copied' : 'Copy memo'}
              </button>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-2 text-[11.5px] text-[var(--ot-text-3)]">
            <span>Credited to NEAR account</span>
            <span className="font-mono">
              {address.found.account.slice(0, 6)}…{address.found.account.slice(-6)}
            </span>
          </div>
        </>
      )}
    </section>
  )
}

function DepositAddress({ text }: { text: string }) {
  const { start, middle, end } = addressParts(text)
  return (
    <div className="flex flex-col gap-1.5">
      <span className="ink-eyebrow">NEAR Intents deposit address · not your own</span>
      <p className="ink-address selectable m-0" data-address>
        <strong>{start}</strong>
        {middle}
        <strong>{end}</strong>
      </p>
      <p className="m-0 text-[12px] leading-[1.45] text-[var(--ot-text-3)]">After scanning or pasting, check that the first and last six characters match the highlighted ones.</p>
    </div>
  )
}
