import { useEffect, useRef, useState } from 'react'
import type { Account, AccountChain } from '../../../../shared/accounts'
import { Otto } from '@/components/brand/otto'
import { Sea } from '@/components/motion/sea'
import { CheckIcon, CopyIcon } from '@/components/shell/icons'
import { Callout, ChainLogo, IntentsLogo, TokenLogo } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ACCOUNT_CHAIN_MARK, type ChainId } from '@/lib/logos'
import { assetKind, CHAIN_ASSETS, CHAIN_SUB, EVM_NETWORKS, receiveAsset, receiveNetwork } from '@/lib/receive'
import { addressParts, CHAIN_INFO, vaultMessage } from '@/lib/wallet'
import { QrCode } from './qr-code'

type Loaded = { kind: 'loading' } | { kind: 'ready'; accounts: Account[] } | { kind: 'failed'; message: string }

/**
 * Your own address on a chain, to fund the wallet: pick where the money comes
 * from, then what it is, and Ink shows the one address to use with its QR code.
 * Only reachable while unlocked.
 */
export function ReceiveView({ startChain = null }: { /** The chain to open on, as when Portfolio asks for one chain's address. */ startChain?: AccountChain | null } = {}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [chain, setChain] = useState<AccountChain | null>(startChain)
  const [asset, setAsset] = useState<string | null>(null)
  const [network, setNetwork] = useState<ChainId>('ethereum')

  useEffect(() => {
    let current = true
    window.ink.vaultAccounts().then(
      (result) => {
        if (!current) return
        setLoaded(result.ok ? { kind: 'ready', accounts: result.accounts } : { kind: 'failed', message: vaultMessage(result.reason) })
      },
      (error: unknown) => {
        console.error('Could not read accounts', error)
        if (current) setLoaded({ kind: 'failed', message: 'Ink couldn’t read your addresses. Try again.' })
      },
    )
    return () => {
      current = false
    }
  }, [])

  const accounts = loaded.kind === 'ready' ? loaded.accounts : []
  const account = accounts.find((item) => item.chain === chain) ?? accounts[0]

  return (
    <main className="ink-panel" id="main">
      <Sea shafts={false} />
      <div className="ink-panel__scroll flex flex-col gap-5 px-7 py-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-[28px] font-bold tracking-[-0.02em]">Receive</h1>
          <p className="m-0 max-w-[62ch] text-[14px] leading-[1.55] text-[var(--ot-text-2)]">
            Pick where the money’s coming from. Ink shows the one address to use, and its QR code.
          </p>
        </div>
        {loaded.kind === 'loading' ? (
          <p className="m-0 text-[14px] text-[var(--ot-text-3)]">Working out your addresses…</p>
        ) : loaded.kind === 'failed' ? (
          <Callout severity="block" title="No addresses" compact className="max-w-[720px]">
            {loaded.message}
          </Callout>
        ) : account ? (
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-5">
              <section aria-labelledby="receive-chain" className="flex flex-col gap-2.5">
                <h2 id="receive-chain" className="ink-step">
                  <span className="ink-step__n">1</span>Which chain?
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-1.5">
                  {accounts.map((item) => (
                    <button
                      key={item.chain}
                      type="button"
                      className={cn('ink-choice', item.chain === account.chain && 'ink-choice--on')}
                      aria-pressed={item.chain === account.chain}
                      onClick={() => setChain(item.chain)}
                    >
                      <ChainLogo chain={ACCOUNT_CHAIN_MARK[item.chain]} size="md" />
                      <span className="flex min-w-0 flex-col text-left">
                        <span className="text-[13px] font-bold">{item.chain === 'evm' ? 'EVM' : CHAIN_INFO[item.chain].name}</span>
                        <span className="text-[11.5px] text-[var(--ot-text-3)]">{CHAIN_SUB[item.chain]}</span>
                      </span>
                    </button>
                  ))}
                  <div className="ink-choice ink-choice--later" aria-label="More chains through NEAR Intents, later">
                    <span className="ink-logo-stack" aria-hidden>
                      <IntentsLogo chain="ton" size="sm" />
                      <IntentsLogo chain="xrp" size="sm" />
                    </span>
                    <span className="flex min-w-0 flex-col text-left">
                      <span className="text-[13px] font-bold">More chains</span>
                      <span className="text-[11.5px]">through NEAR Intents, later</span>
                    </span>
                  </div>
                </div>
              </section>

              {account.chain === 'evm' ? (
                <section aria-labelledby="receive-network" className="flex flex-col gap-2.5">
                  <h2 id="receive-network" className="ink-step">
                    <span className="ink-step__n">2</span>Which network is it sent on?
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {EVM_NETWORKS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={cn('ink-pill', item.id === network && 'ink-pill--on')}
                        aria-pressed={item.id === network}
                        onClick={() => setNetwork(item.id)}
                      >
                        <ChainLogo chain={item.id} size="md" />
                        {item.name}
                      </button>
                    ))}
                  </div>
                  <p className="m-0 text-[12.5px] text-[var(--ot-text-3)]">
                    Same address on every EVM network. Picking one labels the QR, so you tell the sender the right network.
                  </p>
                </section>
              ) : null}

              <section aria-labelledby="receive-asset" className="flex flex-col gap-2.5">
                <h2 id="receive-asset" className="ink-step">
                  <span className="ink-step__n">{account.chain === 'evm' ? 3 : 2}</span>What are you receiving?
                </h2>
                <div className="flex flex-wrap gap-2">
                  {CHAIN_ASSETS[account.chain].map((symbol) => {
                    const on = symbol === receiveAsset(account.chain, asset)
                    return (
                      <button key={symbol} type="button" className={cn('ink-pill', on && 'ink-pill--on')} aria-pressed={on} onClick={() => setAsset(symbol)}>
                        <TokenLogo symbol={symbol} size="md" />
                        {symbol}
                        <span className="text-[11.5px] font-medium text-[var(--ot-text-3)]">{assetKind(account.chain, symbol)}</span>
                      </button>
                    )
                  })}
                </div>
              </section>

              <p className="m-0 max-w-[62ch] text-[12px] leading-[1.5] text-[var(--ot-text-3)]">
                Ink can’t send yet, so what you receive stays at these addresses. Another wallet given your recovery phrase
                reaches them if it uses the same path, shown under the address. Most do, but some use another path for Solana.
              </p>
            </div>

            {/* Keyed by chain, so Copied never carries over to another chain's address. */}
            <AddressCard key={account.chain} account={account} asset={receiveAsset(account.chain, asset)} network={network} />
          </div>
        ) : null}
      </div>
    </main>
  )
}

function AddressCard({ account, asset, network }: { account: Account; asset: string; network: ChainId }) {
  const info = CHAIN_INFO[account.chain]
  const mark: ChainId = account.chain === 'evm' ? network : ACCOUNT_CHAIN_MARK[account.chain]
  const networkName = receiveNetwork(account.chain, info.name, network)
  const { start, middle, end } = addressParts(account.address)
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no')
  const alive = useRef(true)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      window.clearTimeout(timer.current)
    }
  }, [])

  const copy = async () => {
    const result = await window.ink.copyAddress(account.chain).catch(() => ({ ok: false as const }))
    // The card may be gone by now, if someone picked another chain while the copy ran.
    if (!alive.current) return
    setCopied(result.ok ? 'yes' : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied('no'), 2000)
  }

  return (
    <section aria-label={`Your ${info.name} address`} className="ink-address-card" data-chain={account.chain}>
      <Otto pose="base" size={70} animated className="ink-address-card__otto" />
      <div className="flex items-center gap-2.5">
        <TokenLogo symbol={asset} chain={mark} size="md" />
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold">Receive {asset}</div>
          <div className="text-[12px] text-[var(--ot-text-3)]">on {networkName}</div>
        </div>
      </div>

      <div className="ink-qr-frame">
        <QrCode value={account.address} label={`QR code for your ${info.name} address`} size={216} />
        <span className="ink-qr-frame__mark">
          <ChainLogo chain={mark} size="lg" />
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="ink-eyebrow">Your {info.name} address</span>
        <p className="ink-address selectable m-0" data-address>
          <strong>{start}</strong>
          {middle}
          <strong>{end}</strong>
        </p>
        <p className="m-0 text-[12px] leading-[1.45] text-[var(--ot-text-3)]">
          After scanning or pasting, check that the first and last six characters match the highlighted ones.
        </p>
      </div>

      <div className="ink-address-card__warn">
        <strong>
          Send only {asset} on {networkName} here
        </strong>
        <span>{info.note}</span>
      </div>
      <button type="button" className="ink-copy" onClick={copy} aria-label={`Copy ${info.name} address`}>
        {copied === 'yes' ? <CheckIcon /> : <CopyIcon />}
        {copied === 'yes' ? 'Copied' : copied === 'failed' ? 'Couldn’t copy' : 'Copy address'}
      </button>
      <div className="flex items-center justify-between gap-2 text-[11.5px] text-[var(--ot-text-3)]">
        <span className="font-mono">{account.path}</span>
        <span>from your one recovery phrase</span>
      </div>
    </section>
  )
}
