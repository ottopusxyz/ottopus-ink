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

/** The chip on a deposit card, and whether it shows the ring. */
export function depositChip({ kind, progress }: Pick<ChatDeposit, 'kind' | 'progress'>): { text: string; tone: Tone; moving: boolean } {
  switch (progress.stage) {
    case 'watching':
      return { text: kind === 'own' ? 'Watching your balance' : 'Watching', tone: 'plan', moving: true }
    case 'seen':
      return { text: 'On its way', tone: 'warn', moving: true }
    case 'credited':
      return { text: 'Arrived', tone: 'ok', moving: false }
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
  credited: { pose: 'confirmed', moving: false },
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
export function depositLine(deposit: Pick<ChatDeposit, 'kind' | 'chainName' | 'asset' | 'min' | 'progress'>): string | null {
  const { progress, chainName, kind } = deposit
  switch (progress.stage) {
    case 'watching':
      return null
    case 'seen':
      return `Seen on ${chainName}. NEAR Intents is crediting it.`
    case 'credited':
      return kind === 'intents' ? 'In your Intents balance.' : `In your ${chainName} balance.`
    case 'failed':
      return `NEAR Intents didn’t credit it${deposit.min ? `, likely under its ${deposit.min} ${deposit.asset} minimum` : ''}. Ink can’t move it back: contact NEAR Intents with the transaction.`
    case 'stopped':
      return progress.tx
        ? 'Ink stopped checking. NEAR Intents still credits it on its own; it shows in Portfolio once it has.'
        : `Nothing arrived in a day. The address still works: anything sent later lands ${kind === 'intents' ? 'in your Intents balance' : 'in your wallet'} and shows in Portfolio.`
    case 'unwatched':
      return `Ink can’t watch ${chainName} balances yet. What arrives shows in Portfolio.`
  }
}
