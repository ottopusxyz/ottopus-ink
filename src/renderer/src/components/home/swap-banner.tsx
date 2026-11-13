import type { RecentSwap } from '../../../../shared/ipc'
import { Ring } from '@/components/motion/ring'
import { CheckIcon, ExternalIcon } from '@/components/shell/icons'
import { TokenLogo } from '@/components/ui'
import { swapLine } from '@/components/chat/plan-card'

/**
 * A swap Ink is following, or followed lately, on Home: what went in and what it's for,
 * where it stands, and its payout once there is one. Main wrote every value from the
 * plan's fixed terms and NEAR Intents' reports.
 */
export function SwapBanner({ swap }: { swap: RecentSwap }) {
  const stage = swap.progress?.stage ?? 'deposited'
  const settled = stage === 'done' || stage === 'refunded' || stage === 'failed' || stage === 'unknown'
  const title = stage === 'done' ? `Swap done: ${swap.send} → ${swap.progress?.got ?? swap.get} ${swap.where}` : `${settled ? 'Swap' : 'Swapping'} ${swap.send} → ${swap.get} ${swap.where}`
  return (
    <div className="ink-waiting cursor-default" role="status">
      {settled ? (
        <span className="flex size-5 items-center justify-center rounded-full bg-[var(--ot-ok)] text-white" aria-hidden>
          <CheckIcon size={12} />
        </span>
      ) : (
        <Ring size={20} tone="plan" />
      )}
      <TokenLogo symbol={swap.get} size="md" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="selectable text-[15px] font-bold [overflow-wrap:anywhere]">{title}</span>
        <span className="text-[13px] text-[var(--ot-text-2)]">{swap.progress ? swapLine(swap.progress) : 'NEAR ran the deposit. NEAR Intents is picking it up.'}</span>
      </span>
      {swap.progress?.link ? (
        <a className="ink-waiting__go gap-1.5 no-underline" href={swap.progress.link} target="_blank" rel="noreferrer">
          See the payout
          <ExternalIcon size={12} />
        </a>
      ) : null}
    </div>
  )
}
