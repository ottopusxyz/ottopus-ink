import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { ChatSwap } from '../../shared/ipc'
import type { PlanSwap } from '../../shared/plan'
import type { SecretBox } from '../external/sign-ins'

/** A swap Ink follows, as kept across restarts. */
export interface JournalEntry {
  planId: string
  swap: PlanSwap
  /** The NEAR transaction that sent its deposit. */
  txHash: string
  /** When NEAR ran the deposit, ms since the epoch. */
  startedAt: number
  /** Where it stood when last heard. Null before NEAR Intents said anything. */
  progress: ChatSwap | null
}

export interface SwapJournal {
  /** Newest first. */
  list(): JournalEntry[]
  put(entry: JournalEntry): void
  update(planId: string, progress: ChatSwap): void
}

/** Swaps kept, and for how long: enough for Home to show the last few. */
export const JOURNAL_KEEP = 20
export const JOURNAL_MAX_AGE_MS = 7 * 24 * 60 * 60_000

const STAGES = new Set(['deposited', 'swapping', 'done', 'refunded', 'failed', 'unknown'])
const SWAP_FIELDS = ['via', 'depositAddress', 'deadline', 'originAsset', 'destinationAsset', 'amountIn', 'amountOut', 'minAmountOut', 'sendSymbol', 'getSymbol', 'getDecimals', 'getChain', 'recipient', 'refundTo', 'feeBps', 'seconds']

const isText = (value: unknown, max = 300): value is string => typeof value === 'string' && value.length <= max

/** One kept entry, only in the shape this version writes. Anything else is dropped, not trusted. */
function entryOf(value: unknown): JournalEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const { planId, swap, txHash, startedAt, progress } = value as Record<string, unknown>
  if (!isText(planId, 64) || !isText(txHash, 64) || typeof startedAt !== 'number' || typeof swap !== 'object' || swap === null) return null
  if (!SWAP_FIELDS.every((field) => isText((swap as Record<string, unknown>)[field]))) return null
  const { payFrom, sendDecimals } = swap as Record<string, unknown>
  if (!(payFrom === undefined || payFrom === 'intents') || !(sendDecimals === undefined || (isText(sendDecimals, 2) && /^[0-9]{1,2}$/.test(sendDecimals)))) return null
  let kept: ChatSwap | null = null
  if (progress !== null) {
    const { stage, got, refunded, link } = (progress ?? {}) as Record<string, unknown>
    const optional = (text: unknown) => text === null || isText(text)
    if (typeof stage !== 'string' || !STAGES.has(stage) || !optional(got) || !optional(refunded) || !(link === null || (isText(link) && link.startsWith('https://')))) return null
    kept = { stage: stage as ChatSwap['stage'], got: got as string | null, refunded: refunded as string | null, link: link as string | null }
  }
  return { planId, swap: swap as PlanSwap, txHash, startedAt, progress: kept }
}

/**
 * The swaps Ink follows, kept across restarts so it can pick them up again and Home can
 * show them. They hold addresses and amounts, so they're kept like the saved portfolio:
 * encrypted by the OS keyring, or in memory for this run only where there is none.
 */
export function createSwapJournal({ file, box, now = Date.now }: { file: string; box: SecretBox; now?: () => number }): SwapJournal {
  let entries: JournalEntry[] | null = null

  const load = (): JournalEntry[] => {
    if (!box.canKeep()) return []
    try {
      const parsed: unknown = JSON.parse(box.open(readFileSync(file)))
      return Array.isArray(parsed) ? parsed.map(entryOf).filter((entry): entry is JournalEntry => entry !== null) : []
    } catch {
      return []
    }
  }

  const all = (): JournalEntry[] => {
    entries ??= load()
    entries = entries.filter((entry) => now() - entry.startedAt < JOURNAL_MAX_AGE_MS).slice(0, JOURNAL_KEEP)
    return entries
  }

  const write = () => {
    if (!box.canKeep() || !entries) return
    try {
      const temporary = `${file}.${randomUUID()}`
      writeFileSync(temporary, box.seal(JSON.stringify(entries)), { mode: 0o600 })
      renameSync(temporary, file)
    } catch {
      // Not kept on disk this time; the copy in memory still serves this run.
    }
  }

  return {
    list: () => [...all()],
    put(entry) {
      entries = [entry, ...all().filter((kept) => kept.planId !== entry.planId)].slice(0, JOURNAL_KEEP)
      write()
    },
    update(planId, progress) {
      const kept = all().find((entry) => entry.planId === planId)
      if (!kept) return
      kept.progress = progress
      write()
    },
  }
}
