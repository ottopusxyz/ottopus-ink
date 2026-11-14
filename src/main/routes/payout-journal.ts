import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { PlanSwap } from '../../shared/plan'
import type { SecretBox } from '../external/sign-ins'

/**
 * A payment's payout, signed and waiting for its legs, as kept across restarts: the signed
 * NEAR transaction, which legs it waits for, and its terms. Ink sends it once the legs land,
 * whether or not it restarted in between.
 */
export interface HeldPayout {
  planId: string
  /** The signed transaction, as hex. */
  signed: string
  transactionId: string
  /** The NEAR key that signed it, and the nonce and block it was built with: nothing else is sent from the key meanwhile. */
  keyId: string
  nonce: string
  blockHeight: string
  /** The payout's place among the plan's steps and swaps. */
  step: number
  swap: number
  /** The legs it waits for, as the swap tracker follows them: `<plan>#<leg>`. */
  legIds: string[]
  payout: PlanSwap
  heldAt: number
}

export interface PayoutJournal {
  list(): HeldPayout[]
  put(entry: HeldPayout): void
  remove(planId: string): void
}

/** Kept no longer than a signed NEAR transaction can land: past this it's dead anyway. */
export const PAYOUT_MAX_AGE_MS = 36 * 60 * 60_000

const WHOLE = /^(0|[1-9][0-9]{0,30})$/

function entryOf(value: unknown): HeldPayout | null {
  if (typeof value !== 'object' || value === null) return null
  const entry = value as Record<string, unknown>
  const text = (field: string, pattern: RegExp) => typeof entry[field] === 'string' && pattern.test(entry[field] as string)
  if (!text('planId', /^[A-Za-z0-9-]{1,64}$/) || !text('signed', /^[0-9a-f]{2,8000}$/) || !text('transactionId', /^[A-Za-z0-9]{8,128}$/) || !text('keyId', /^[A-Za-z0-9:.\- ]{1,300}$/)) return null
  if (!text('nonce', WHOLE) || !text('blockHeight', WHOLE) || !Number.isInteger(entry.step) || !Number.isInteger(entry.swap) || typeof entry.heldAt !== 'number') return null
  if (!Array.isArray(entry.legIds) || !entry.legIds.every((id) => typeof id === 'string' && id.length <= 80)) return null
  const payout = entry.payout as Record<string, unknown> | null
  if (!payout || payout.role !== 'payout' || typeof payout.depositAddress !== 'string' || typeof payout.amountOut !== 'string') return null
  return entry as unknown as HeldPayout
}

/**
 * The payouts Ink holds, sealed by the OS keyring like the swaps, since each is a signed
 * transaction that moves money. Where there's no keyring they're kept for this run only.
 */
export function createPayoutJournal({ file, box, now = Date.now }: { file: string; box: SecretBox; now?: () => number }): PayoutJournal {
  let entries: HeldPayout[] | null = null

  const all = (): HeldPayout[] => {
    if (!entries) {
      try {
        const parsed: unknown = box.canKeep() ? JSON.parse(box.open(readFileSync(file))) : []
        entries = Array.isArray(parsed) ? parsed.map(entryOf).filter((entry): entry is HeldPayout => entry !== null) : []
      } catch {
        entries = []
      }
    }
    entries = entries.filter((entry) => now() - entry.heldAt < PAYOUT_MAX_AGE_MS)
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
      entries = [entry, ...all().filter((each) => each.planId !== entry.planId)]
      write()
    },
    remove(planId) {
      entries = all().filter((each) => each.planId !== planId)
      write()
    },
  }
}
