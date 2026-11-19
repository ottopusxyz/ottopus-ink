import type { ChatDeposit, DepositProgress } from '../../../shared/ipc'
import type { PoseName } from '@/components/brand/otto'
import type { Tone } from '@/components/ui'

/** How long Ink still watches, in a few words. */
export function timeLeft(until: number, now: number): string {
  const minutes = Math.ceil((until - now) / 60_000)
  if (minutes <= 1) return 'under a minute left'
  if (minutes < 60) return `${minutes} min left`
  return `${Math.ceil(minutes / 60)} h left`
}

/** When a NEAR Intents address closes, as the person reads it: "Sun, 22 Nov, 10:28". */
export function closesAt(until: number): string {
  return new Date(until).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Whether a card's NEAR Intents address has closed, so nothing should be sent to it. */
export const addressClosed = ({ kind, closes }: Pick<ChatDeposit, 'kind' | 'closes'>, now: number): boolean => kind === 'intents' && closes !== null && now >= closes

/** The chip on a deposit card, and whether it shows the ring. */
export function depositChip({ kind, progress }: Pick<ChatDeposit, 'kind' | 'progress'>): { text: string; tone: Tone; moving: boolean } {
  switch (progress.stage) {
    case 'watching':
      return { text: kind === 'own' ? 'Watching your balance' : 'Watching', tone: 'plan', moving: true }
    case 'seen':
      return { text: 'On its way', tone: 'warn', moving: true }
    case 'short':
      return { text: 'Under the minimum', tone: 'warn', moving: true }
    case 'credited':
      return { text: 'Arrived', tone: 'ok', moving: false }
    case 'refunded':
      return { text: 'Refunded', tone: 'neutral', moving: false }
    case 'failed':
      return { text: 'Not credited', tone: 'block', moving: false }
    case 'stopped':
      return { text: 'Not watching', tone: 'neutral', moving: false }
    case 'unwatched':
      return { text: 'Not watched', tone: 'neutral', moving: false }
  }
}

/** Otto for where a deposit stands: keeping watch, juggling while it's credited, cheering, or in the ink. */
export const DEPOSIT_POSE: Record<DepositProgress['stage'], { pose: PoseName; moving: boolean }> = {
  watching: { pose: 'tapping', moving: true },
  seen: { pose: 'loader', moving: true },
  short: { pose: 'tapping', moving: true },
  credited: { pose: 'confirmed', moving: false },
  refunded: { pose: 'base', moving: false },
  failed: { pose: 'ink', moving: false },
  stopped: { pose: 'base', moving: false },
  unwatched: { pose: 'base', moving: false },
}

/** Under the amount: the chain it's sent on, and where it lands. */
export function depositWhere({ kind, chainName }: Pick<ChatDeposit, 'kind' | 'chainName'>): string {
  return kind === 'intents' ? `sent on ${chainName} · lands in your Intents balance` : `sent on ${chainName} · to your own address`
}

/** The card's lead: what arrived once seen, else what the person said is coming, else the token. */
export function depositAmount({ asset, amount, progress }: Pick<ChatDeposit, 'asset' | 'amount' | 'progress'>): string {
  return progress.got ?? (amount ? `${amount} ${asset}` : asset)
}

/** What the card says once the deposit moved on, or Ink stopped. Null while it's watching. */
export function depositLine(deposit: Pick<ChatDeposit, 'kind' | 'chainName' | 'asset' | 'min' | 'closes' | 'progress'>, now: number = Date.now()): string | null {
  const { progress, chainName, kind } = deposit
  const closes = kind === 'intents' ? deposit.closes : null
  const closed = closes !== null && now >= closes
  switch (progress.stage) {
    case 'watching':
      return null
    case 'seen':
      return `Seen on ${chainName}. NEAR Intents is crediting it.`
    case 'short':
      return closed
        ? `It was under NEAR Intents’ ${deposit.min ? `${deposit.min} ${deposit.asset} ` : ''}minimum, and the address has closed: NEAR Intents refunds it into your Intents balance.`
        : `That’s under NEAR Intents’ ${deposit.min ? `${deposit.min} ${deposit.asset} ` : ''}minimum, so it isn’t credited yet. Send the rest to this address before ${closesAt(closes ?? now)}, or it’s refunded into your Intents balance after that.`
    case 'credited':
      return kind === 'intents' ? 'In your Intents balance.' : `In your ${chainName} balance.`
    case 'refunded':
      return `NEAR Intents didn’t take it${deposit.min ? `, likely under its ${deposit.min} ${deposit.asset} minimum` : ''}, and refunded it into your Intents balance.`
    case 'failed':
      return `NEAR Intents didn’t credit it${deposit.min ? `, likely under its ${deposit.min} ${deposit.asset} minimum` : ''}. Ink can’t move it back: contact NEAR Intents with the transaction.`
    case 'stopped':
      if (progress.tx) return 'Ink stopped checking. NEAR Intents still credits it on its own; it shows in Portfolio once it has.'
      if (kind !== 'intents') return 'Nothing arrived in a day. The address still works: anything sent later lands in your wallet and shows in Portfolio.'
      if (closes === null) return 'Nothing arrived in a day. Ask your agent for a new address before sending more.'
      return closed
        ? 'Nothing arrived, and the address has closed: send nothing to it. Ask your agent for a new one.'
        : `Nothing arrived in a day. The address stays open until ${closesAt(closes)}: anything sent before then lands in your Intents balance.`
    case 'unwatched':
      return `Ink can’t watch ${chainName} balances yet. What arrives shows in Portfolio.`
  }
}
