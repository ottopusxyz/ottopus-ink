import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { ChatDeposit, DepositProgress } from '../../shared/ipc'
import type { SecretBox } from '../external/sign-ins'
import type { DepositJournal, WatchEntry } from './deposit-watch'

/** Watches kept, and for how long. */
export const DEPOSITS_KEEP = 30
export const DEPOSITS_MAX_AGE_MS = 7 * 24 * 60 * 60_000

const STAGES = new Set<DepositProgress['stage']>(['watching', 'seen', 'credited', 'failed', 'stopped', 'unwatched'])
const WHYS = new Set(['not-in-intents', 'below-minimum', 'intents-unavailable'])

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const isText = (value: unknown, max = 300): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const orNull = (value: unknown, max = 300) => value === null || isText(value, max)

/** A deposit's progress, only in the shape main writes. */
export function isProgress(value: unknown): value is DepositProgress {
  const progress = record(value)
  return (
    progress !== null &&
    STAGES.has(progress.stage as DepositProgress['stage']) &&
    orNull(progress.got) &&
    orNull(progress.tx, 128) &&
    (progress.link === null || (isText(progress.link) && progress.link.startsWith('https://'))) &&
    typeof progress.until === 'number'
  )
}

/** A deposit card, only in the shape main writes. */
export function isDeposit(value: unknown): value is ChatDeposit {
  const deposit = record(value)
  if (!deposit || !isText(deposit.id, 64) || (deposit.kind !== 'intents' && deposit.kind !== 'own')) return false
  if (!['chain', 'chainName', 'asset', 'address'].every((field) => isText(deposit[field]))) return false
  if (!['mark', 'amount', 'memo', 'min', 'account'].every((field) => orNull(deposit[field]))) return false
  // An icon is a data: URL main made, up to the icon size limit.
  if (!(deposit.icon === null || (typeof deposit.icon === 'string' && deposit.icon.startsWith('data:image/') && deposit.icon.length <= 100_000))) return false
  return (deposit.why === null || WHYS.has(deposit.why as string)) && isProgress(deposit.progress)
}

/** One kept watch, only in the shape this version writes. Anything else is dropped, not trusted. */
function entryOf(value: unknown): WatchEntry | null {
  const entry = record(value)
  if (!entry || !isDeposit(entry.deposit) || !isText(entry.owner, 128) || !orNull(entry.historyId, 64) || !orNull(entry.bridge, 40) || !orNull(entry.zerion, 40)) return null
  if (!Array.isArray(entry.assetIds) || !entry.assetIds.every((id) => isText(id, 200))) return null
  if (!(entry.before === null || (Array.isArray(entry.before) && entry.before.every((tx) => isText(tx, 128))))) return null
  if (!(entry.baseline === null || (typeof entry.baseline === 'string' && /^[0-9]{1,80}$/.test(entry.baseline))) || typeof entry.startedAt !== 'number') return null
  return entry as unknown as WatchEntry
}

/**
 * The deposits Ink watches, kept across restarts so it can pick them up again. They
 * hold addresses and amounts, so they're kept like the swaps: encrypted by the OS
 * keyring, or in memory for this run only where there is none.
 */
export function createDepositJournal({ file, box, now = Date.now }: { file: string; box: SecretBox; now?: () => number }): DepositJournal {
  let entries: WatchEntry[] | null = null

  const load = (): WatchEntry[] => {
    if (!box.canKeep()) return []
    try {
      const parsed: unknown = JSON.parse(box.open(readFileSync(file)))
      return Array.isArray(parsed) ? parsed.map(entryOf).filter((entry): entry is WatchEntry => entry !== null) : []
    } catch {
      return []
    }
  }

  const all = (): WatchEntry[] => {
    entries ??= load()
    entries = entries.filter((entry) => now() - entry.startedAt < DEPOSITS_MAX_AGE_MS).slice(0, DEPOSITS_KEEP)
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
      const kept = all()
      const at = kept.findIndex((each) => each.deposit.id === entry.deposit.id)
      // A watch keeps its place; a new one goes first.
      entries = at >= 0 ? kept.map((each, index) => (index === at ? entry : each)) : [entry, ...kept].slice(0, DEPOSITS_KEEP)
      write()
    },
  }
}
