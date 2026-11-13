import type { ChatSwap } from '../../shared/ipc'
import type { PlanSwap } from '../../shared/plan'
import { formatUnits } from '../../shared/token-text'
import type { SwapReport, SwapStage } from './one-click'

/** How often a swap is checked while it runs. 1Click swaps take seconds to minutes. */
export const SWAP_POLL_MS = 5_000
/** How long past the deposit address's deadline Ink keeps checking: 1Click refunds by then. */
export const SWAP_FOLLOW_AFTER_DEADLINE_MS = 15 * 60_000

export interface SwapTrackerDeps {
  submit: (deposit: { txHash: string; depositAddress: string; nearSenderAccount: string }) => Promise<SwapReport | null>
  status: (depositAddress: string) => Promise<SwapReport | null>
  /** Told each time a swap moves on. */
  onUpdate: (planId: string, swap: ChatSwap) => void
  now?: () => number
  wait?: (ms: number) => Promise<void>
}

const STAGES: Record<SwapStage, ChatSwap['stage']> = {
  PENDING_DEPOSIT: 'deposited',
  KNOWN_DEPOSIT_TX: 'deposited',
  INCOMPLETE_DEPOSIT: 'deposited',
  PROCESSING: 'swapping',
  SUCCESS: 'done',
  REFUNDED: 'refunded',
  FAILED: 'failed',
}
const FINAL: ReadonlySet<ChatSwap['stage']> = new Set(['done', 'refunded', 'failed', 'unknown'])

/** A report in words for the chat, with amounts at the plan's own decimals. */
function progressOf(report: SwapReport, swap: PlanSwap): ChatSwap {
  const stage = STAGES[report.stage]
  const decimals = /^[0-9]{1,2}$/.test(swap.getDecimals) ? Number(swap.getDecimals) : null
  const got = stage === 'done' && report.amountOut !== null && decimals !== null ? `${formatUnits(report.amountOut, decimals)} ${swap.getSymbol}` : null
  // The deposit was wrapped NEAR, so that's what a refund pays back.
  const refunded = stage === 'refunded' && report.refunded !== null && swap.originAsset === 'nep141:wrap.near' ? `${formatUnits(report.refunded, 24)} NEAR` : null
  return { stage, got, refunded, link: report.payoutTx?.explorerUrl ?? null }
}

const same = (a: ChatSwap | undefined, b: ChatSwap) => a !== undefined && a.stage === b.stage && a.got === b.got && a.refunded === b.refunded && a.link === b.link

/**
 * Follows each swap whose deposit NEAR ran: tells 1Click the deposit's transaction, then
 * asks where the swap stands until it's done, refunded or failed, or until well past the
 * deposit address's deadline, when it says it stopped checking. Kept in memory while
 * Ink runs; an app restart forgets it, though 1Click finishes or refunds regardless.
 */
export function createSwapTracker({ submit, status, onUpdate, now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }: SwapTrackerDeps) {
  const latest = new Map<string, ChatSwap>()

  const update = (planId: string, swap: ChatSwap) => {
    if (same(latest.get(planId), swap)) return
    latest.set(planId, swap)
    onUpdate(planId, swap)
  }

  return {
    /** Starts following a swap from its deposit's transaction. Resolves once it's settled or Ink gives up on it. */
    async follow(planId: string, swap: PlanSwap, txHash: string): Promise<ChatSwap> {
      update(planId, { stage: 'deposited', got: null, refunded: null, link: null })
      const told = await submit({ txHash, depositAddress: swap.depositAddress, nearSenderAccount: swap.refundTo }).catch(() => null)
      if (told) update(planId, progressOf(told, swap))
      const until = Date.parse(swap.deadline) + SWAP_FOLLOW_AFTER_DEADLINE_MS
      while (!FINAL.has(latest.get(planId)?.stage ?? 'deposited')) {
        if (now() > until) {
          update(planId, { ...(latest.get(planId) as ChatSwap), stage: 'unknown' })
          break
        }
        await wait(SWAP_POLL_MS)
        const report = await status(swap.depositAddress).catch(() => null)
        if (report) update(planId, progressOf(report, swap))
      }
      return latest.get(planId) as ChatSwap
    },

    /** Where a swap stands, as last heard. Null for a plan whose swap isn't being followed. */
    get: (planId: string): ChatSwap | null => latest.get(planId) ?? null,
  }
}

export type SwapTracker = ReturnType<typeof createSwapTracker>
