import type { ChatSwap } from '../../shared/ipc'
import type { PlanSwap } from '../../shared/plan'
import { formatUnits } from '../../shared/token-text'
import type { SwapReport, SwapStage } from './one-click'
import type { JournalEntry, SwapJournal } from './swap-journal'
import { oneClickTxPage } from '../intents/explorers'
import { swapSent } from './swap-terms'

/** How often a swap is checked while it runs. 1Click swaps take seconds to minutes. */
export const SWAP_POLL_MS = 5_000
/** How long past the deposit address's deadline Ink keeps checking: 1Click refunds by then. */
export const SWAP_FOLLOW_AFTER_DEADLINE_MS = 15 * 60_000

export interface SwapTrackerDeps {
  submit: (deposit: { txHash: string; depositAddress: string; nearSenderAccount?: string }) => Promise<SwapReport | null>
  status: (depositAddress: string) => Promise<SwapReport | null>
  /** Told each time a swap moves on. */
  onUpdate: (planId: string, swap: ChatSwap) => void
  /** Where followed swaps are kept across restarts. */
  journal?: SwapJournal
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
  // A refund pays back what was sent: wrapped NEAR from the wallet, or the token from the Intents balance.
  const refunded = stage === 'refunded' && report.refunded !== null ? swapSent({ ...swap, amountIn: report.refunded.toString() }) : null
  // 1Click names an explorer page for some payouts and not others, such as BNB Chain's: then Ink makes one from the hash.
  const payout = report.payoutTx
  const link = payout ? (payout.explorerUrl ?? oneClickTxPage(swap.getChain, payout.hash)?.url ?? null) : null
  return { stage, got, refunded, link }
}

const same = (a: ChatSwap | undefined, b: ChatSwap) => a !== undefined && a.stage === b.stage && a.got === b.got && a.refunded === b.refunded && a.link === b.link

/**
 * Follows each swap whose deposit NEAR ran: tells 1Click the deposit's transaction, then
 * asks where the swap stands until it's done, refunded or failed, or until well past the
 * deposit address's deadline, when it says it stopped checking. With a journal, each
 * swap is kept across restarts and picked up again by `resume`.
 */
export function createSwapTracker({ submit, status, onUpdate, journal, now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }: SwapTrackerDeps) {
  const latest = new Map<string, ChatSwap>()

  const update = (planId: string, swap: ChatSwap) => {
    if (same(latest.get(planId), swap)) return
    latest.set(planId, swap)
    journal?.update(planId, swap)
    onUpdate(planId, swap)
  }

  /** Follows one swap until it settles, or Ink gives up on it. */
  async function follow(planId: string, swap: PlanSwap, txHash: string): Promise<ChatSwap> {
    update(planId, { stage: 'deposited', got: null, refunded: null, link: null })
    // A deposit sent on an EVM chain has no NEAR sender to name.
    const told = await submit({ txHash, depositAddress: swap.depositAddress, ...(swap.payFrom === 'evm' ? {} : { nearSenderAccount: swap.refundTo }) }).catch(() => null)
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
  }

  return {
    /** Starts following a swap from its deposit's transaction, kept across restarts. Resolves once it's settled or Ink gives up on it. */
    follow(planId: string, swap: PlanSwap, txHash: string): Promise<ChatSwap> {
      journal?.put({ planId, swap, txHash, startedAt: now(), progress: null })
      return follow(planId, swap, txHash)
    },

    /** Picks up the swaps a restart cut off, from where they were kept. */
    resume(): void {
      for (const entry of journal?.list() ?? []) {
        if (latest.has(entry.planId) || (entry.progress && FINAL.has(entry.progress.stage))) continue
        void follow(entry.planId, entry.swap, entry.txHash)
      }
    },

    /** Where a swap stands, as last heard this run or kept from before. Null for a plan whose swap isn't followed. */
    get: (planId: string): ChatSwap | null => latest.get(planId) ?? journal?.list().find((entry) => entry.planId === planId)?.progress ?? null,

    /** The swaps followed lately, newest first, with where each stands. */
    recent: (): JournalEntry[] => (journal?.list() ?? []).map((entry) => ({ ...entry, progress: latest.get(entry.planId) ?? entry.progress })),
  }
}

export type SwapTracker = ReturnType<typeof createSwapTracker>
