import { useEffect, useState } from 'react'
import type { Account, AccountChain } from '../../../../shared/accounts'
import { SEA_LIFE } from '@/components/motion/sea-life'
import { Sea } from '@/components/motion/sea'
import { CheckIcon, CopyIcon, QrIcon } from '@/components/shell/icons'
import { Button, Callout, Card } from '@/components/ui'
import { addressParts, CHAIN_INFO, vaultMessage } from '@/lib/wallet'
import { QrCode } from './qr-code'

type Loaded = { kind: 'loading' } | { kind: 'ready'; accounts: Account[] } | { kind: 'failed'; message: string }

/** Your own address on each chain, to fund the wallet. Only reachable while unlocked. */
export function ReceiveView() {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [open, setOpen] = useState<AccountChain | null>(null)

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main className="ink-panel" id="main">
      <Sea creatures={SEA_LIFE} shafts={false} />
      <div className="ink-panel__scroll flex flex-col gap-5 px-7 py-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-[26px] font-bold tracking-[-0.02em]">Receive</h1>
          <p className="m-0 max-w-[62ch] text-[14px] leading-[1.55] text-[var(--ot-text-2)]">
            Your own address on each chain, all from your one recovery phrase. Send each chain’s coins and tokens only to its
            own address.
          </p>
        </div>
        <Callout severity="info" title="Ink can’t send yet" compact className="max-w-[720px]">
          Anything you receive stays at these addresses. Another wallet given your recovery phrase reaches them if it uses
          the same path, shown under each address. Most do, but some use another path for Solana. Deposit addresses for
          chains like TON and XRP come with NEAR Intents.
        </Callout>
        {loaded.kind === 'loading' ? (
          <p className="m-0 text-[14px] text-[var(--ot-text-3)]">Working out your addresses…</p>
        ) : loaded.kind === 'failed' ? (
          <Callout severity="block" title="No addresses" compact className="max-w-[720px]">
            {loaded.message}
          </Callout>
        ) : (
          <ul className="m-0 flex max-w-[720px] list-none flex-col gap-3 p-0">
            {loaded.accounts.map((account) => (
              <li key={account.chain}>
                <AccountRow account={account} open={open === account.chain} onToggle={() => setOpen(open === account.chain ? null : account.chain)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}

function AccountRow({ account, open, onToggle }: { account: Account; open: boolean; onToggle: () => void }) {
  const info = CHAIN_INFO[account.chain]
  const { start, middle, end } = addressParts(account.address)
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no')

  const copy = async () => {
    const result = await window.ink.copyAddress(account.chain).catch(() => ({ ok: false as const }))
    setCopied(result.ok ? 'yes' : 'failed')
    window.setTimeout(() => setCopied('no'), 2000)
  }

  return (
    <Card className="flex flex-col gap-3 p-4" data-chain={account.chain}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="m-0 font-display text-[16px] font-semibold tracking-[-0.01em]">{info.name}</h2>
          <p className="m-0 text-[12.5px] leading-[1.45] text-[var(--ot-text-3)]">{info.note}</p>
        </div>
        <div className="flex flex-none gap-1.5">
          <Button size="sm" variant="secondary" onClick={copy} aria-label={`Copy ${info.name} address`}>
            {copied === 'yes' ? <CheckIcon /> : <CopyIcon />}
            {copied === 'yes' ? 'Copied' : copied === 'failed' ? 'Couldn’t copy' : 'Copy'}
          </Button>
          <Button size="sm" variant={open ? 'primary' : 'secondary'} onClick={onToggle} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${info.name} QR code`}>
            <QrIcon />
            QR
          </Button>
        </div>
      </div>
      <p className="m-0 font-mono text-[13px] leading-[1.6] break-all text-[var(--ot-text-2)]" data-address>
        <strong className="font-semibold text-[var(--ot-text)]">{start}</strong>
        {middle}
        <strong className="font-semibold text-[var(--ot-text)]">{end}</strong>
      </p>
      {open ? (
        <div className="flex items-center gap-4">
          <QrCode value={account.address} label={`QR code for your ${info.name} address`} />
          <p className="m-0 max-w-[32ch] text-[12.5px] leading-[1.5] text-[var(--ot-text-3)]">
            After scanning or pasting, check that the first and last six characters match the ones in bold.
          </p>
        </div>
      ) : null}
      <p className="m-0 font-mono text-[11px] text-[var(--ot-text-4)]">{account.path}</p>
    </Card>
  )
}
