import { useEffect, useRef, useState } from 'react'
import type { ChatDeposit } from '../../../../shared/ipc'
import { Otto } from '@/components/brand/otto'
import { Ring } from '@/components/motion/ring'
import { CheckIcon, CopyIcon, ExternalIcon } from '@/components/shell/icons'
import { Badge, Button, TokenLogo } from '@/components/ui'
import { ChainMark } from '@/components/wallet/chain-mark'
import { QrCode } from '@/components/wallet/qr-code'
import { cn } from '@/lib/cn'
import { DEPOSIT_POSE, depositAmount, depositChip, depositLine, depositWhere, timeLeft } from '@/lib/deposit-card'
import { addressParts } from '@/lib/wallet'

/** Wide enough that a phone scans it from the screen, small enough for a chat. */
const QR_SIZE = 148

/** The clock, a minute at a time, for how long Ink still watches. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/**
 * Where to send a deposit, as Ink's own ticket in the chat: the token and amount as the
 * lead, the QR code and the address under the perforation, and what Ink has seen arrive.
 * Main worked out every value when the agent asked, so an agent can't put an address
 * here. Once a deposit is seen, the QR folds away and the card follows it instead.
 */
export function DepositCard({ deposit, onOpenReceive }: { deposit: ChatDeposit; onOpenReceive?: ((chain: string) => void) | undefined }) {
  const { progress } = deposit
  const now = useMinute()
  const [copied, setCopied] = useState<'none' | 'address' | 'memo' | 'failed'>('none')
  const [again, setAgain] = useState<'idle' | 'asking' | 'failed'>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const chip = depositChip(deposit)
  const pose = DEPOSIT_POSE[progress.stage]
  const line = depositLine(deposit)
  const amount = depositAmount(deposit)
  // The address stays up until something is seen there, and after Ink stops watching it.
  const showAddress = progress.stage === 'watching' || progress.stage === 'unwatched' || (progress.stage === 'stopped' && !progress.tx)
  const { start, middle, end } = addressParts(deposit.address)

  const copy = async (part: 'address' | 'memo') => {
    const result = await window.ink.copyReceive({ chain: deposit.chain, asset: deposit.asset, amount: deposit.amount }, part).catch(() => ({ ok: false }))
    setCopied(result.ok ? part : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied('none'), 2000)
  }

  const watchAgain = async () => {
    setAgain('asking')
    const result = await window.ink.watchDepositAgain(deposit.id).catch(() => ({ ok: false }))
    setAgain(result.ok ? 'idle' : 'failed')
  }

  return (
    <article className="ink-ticket" aria-label={`Deposit ${amount} on ${deposit.chainName}`}>
      <div className="ink-ticket__head">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ink-eyebrow text-[var(--ot-coral-text)]">{showAddress ? 'Where to send it' : 'Deposit'}</span>
            <Badge tone={chip.tone} className="gap-1.5">
              {chip.moving ? <Ring size={11} /> : null}
              {chip.text}
            </Badge>
          </div>
          <p className="ink-ticket__lead selectable m-0">
            <TokenLogo symbol={deposit.asset} chain={deposit.mark} icon={deposit.icon} size="lg" />
            <span className="ink-ticket__amount">{amount}</span>
          </p>
          <span className="text-[12.5px] text-[var(--ot-text-3)]">{depositWhere(deposit)}</span>
        </div>
        <span className="ink-ticket__pocket">
          <Otto pose={pose.pose} size={76} animated={pose.moving} />
        </span>
      </div>
      <div className="ink-ticket__perf" aria-hidden />
      <div className="ink-ticket__foot">
        {showAddress ? (
          <div className="flex flex-wrap items-start gap-4">
            <div className="ink-deposit-qr">
              <QrCode value={deposit.address} label={`QR code for the address to send ${deposit.asset} on ${deposit.chainName}`} size={QR_SIZE} />
              <span className="ink-deposit-qr__mark">
                <ChainMark chain={{ mark: deposit.mark, name: deposit.chainName }} size="sm" />
              </span>
            </div>
            <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-2">
              <span className="ink-eyebrow">{deposit.kind === 'intents' ? 'NEAR Intents deposit address' : `Your ${deposit.chainName} address`}</span>
              <p className="ink-address selectable m-0 text-[13px]" data-address>
                <strong>{start}</strong>
                {middle}
                <strong>{end}</strong>
              </p>
              {deposit.memo ? (
                <p className="m-0 flex flex-col rounded-[10px] border-2 border-[var(--ot-warn-border)] bg-[var(--ot-warn-bg)] px-2.5 py-1.5 text-[12px]">
                  <span className="font-bold text-[var(--ot-warn-text)]">Memo, required</span>
                  <span className="selectable font-mono text-[15px] font-bold">{deposit.memo}</span>
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="ink-copy" onClick={() => void copy('address')} aria-label={`Copy the address to send ${deposit.asset} on ${deposit.chainName}`}>
                  {copied === 'address' ? <CheckIcon /> : <CopyIcon />}
                  {copied === 'address' ? 'Copied' : copied === 'failed' ? 'Couldn’t copy' : 'Copy address'}
                </button>
                {deposit.memo ? (
                  <button type="button" className="ink-copy" onClick={() => void copy('memo')} aria-label="Copy the memo">
                    {copied === 'memo' ? <CheckIcon /> : <CopyIcon />}
                    {copied === 'memo' ? 'Copied' : 'Copy memo'}
                  </button>
                ) : null}
                {onOpenReceive ? (
                  <button type="button" className="ink-text-link" onClick={() => onOpenReceive(deposit.chain)}>
                    Open in Receive
                  </button>
                ) : null}
              </div>
              <p className="m-0 rounded-[10px] bg-[var(--ot-warn-bg)] px-2.5 py-1.5 text-[12px] leading-[1.45]">
                <strong className="text-[var(--ot-warn-text)]">
                  Only {deposit.asset} on {deposit.chainName}
                  {deposit.kind === 'intents' && deposit.min ? `, at least ${deposit.min}` : ''}.
                </strong>{' '}
                {deposit.kind === 'intents' ? `${deposit.min ? 'Less isn’t credited. ' : ''}This address isn’t from your recovery phrase.` : 'From your one recovery phrase.'}
              </p>
            </div>
          </div>
        ) : null}

        {progress.stage === 'seen' ? (
          <ol className="ink-steps" aria-label="The deposit so far">
            <li className="text-[var(--ot-ok-text)]">
              <span className="ink-steps__mark" aria-hidden>
                <CheckIcon size={14} />
              </span>
              Sent on {deposit.chainName}
              {progress.tx ? <span className="font-mono text-[11.5px] text-[var(--ot-text-3)]">{shortTx(progress.tx)}</span> : null}
            </li>
            <li>
              <span className="ink-steps__mark" aria-hidden>
                <span className="ink-dots">
                  <i />
                  <i />
                  <i />
                </span>
              </span>
              NEAR Intents is crediting it
            </li>
            <li className="text-[var(--ot-text-3)]">
              <span className="ink-steps__mark" aria-hidden>
                ·
              </span>
              In your Intents balance
            </li>
          </ol>
        ) : line && progress.stage !== 'watching' ? (
          <p className={cn('m-0 text-[12.5px] leading-[1.5]', progress.stage === 'failed' ? 'text-[var(--ot-block-text)]' : 'text-[var(--ot-text-2)]')}>
            {line}
            {progress.tx && progress.stage !== 'credited' ? <span className="selectable ml-1 font-mono text-[11.5px] [overflow-wrap:anywhere]">{progress.tx}</span> : null}
          </p>
        ) : null}

        {progress.stage === 'watching' ? (
          <div className="flex items-center gap-2.5">
            <div className="ink-tide flex-1" aria-hidden>
              <span />
            </div>
            <span className="font-mono text-[11.5px] text-[var(--ot-text-3)]" role="status">
              nothing yet · {timeLeft(progress.until, now)}
            </span>
          </div>
        ) : null}

        {progress.stage === 'stopped' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={again === 'asking'} onClick={() => void watchAgain()}>
              {again === 'asking' ? <Ring size={13} /> : null}
              Watch for another day
            </Button>
            {again === 'failed' ? <span className="text-[12px] text-[var(--ot-text-3)]">Ink couldn’t watch it again.</span> : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[var(--ot-text-3)]">
          {deposit.kind === 'intents' && deposit.account ? (
            <span>
              Credited to NEAR account{' '}
              <span className="font-mono">
                {deposit.account.slice(0, 6)}…{deposit.account.slice(-6)}
              </span>
            </span>
          ) : (
            <span>Your own address on {deposit.chainName}</span>
          )}
          {progress.link ? (
            <a className="inline-flex items-center gap-1 text-[var(--ot-plan-text)] underline" href={progress.link} target="_blank" rel="noreferrer">
              The transaction <ExternalIcon size={11} />
            </a>
          ) : progress.stage === 'watching' ? (
            <span>Ink tells you and your agent when it lands</span>
          ) : null}
        </div>
      </div>
    </article>
  )
}

/** A transaction hash, short enough for a step line. */
const shortTx = (tx: string) => (tx.length > 16 ? `${tx.slice(0, 6)}…${tx.slice(-4)}` : tx)
