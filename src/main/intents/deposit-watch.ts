import type { ChatDeposit, DepositProgress } from '../../shared/ipc'
import { formatUnits } from '../../shared/token-text'
import type { BridgeDeposit } from './deposits'
import { txPage } from './explorers'

/** How long Ink watches an address for a deposit, from when it's shown or seen. */
export const WATCH_MS = 24 * 60 * 60_000
/** The bridge is asked this often: deposits take from seconds to an hour. */
export const BRIDGE_POLL_MS = 15_000
/** A balance is read less often, since each read is a Zerion call. */
export const BALANCE_POLL_MS = 60_000

/** A deposit Ink watches, as kept across restarts. */
export interface WatchEntry {
  deposit: ChatDeposit
  /** Which chat session asked, so one chat asking twice gets one card. */
  owner: string
  /** The chat's kept history, so what happens after a restart is still recorded there. */
  historyId: string | null
  /** The bridge's name for the chain, for NEAR Intents' address. */
  bridge: string | null
  /** The bridge's ids for the token there. */
  assetIds: string[]
  /** Zerion's name for the chain, for the wallet's own address. Null where Ink reads no balances. */
  zerion: string | null
  /** The deposits the bridge listed before the card, by transaction. Null until first read. */
  before: string[] | null
  /** The address's balance of the token before the card, in its smallest unit. Null until first read. */
  baseline: string | null
  startedAt: number
}

export interface DepositJournal {
  /** Newest first. */
  list(): WatchEntry[]
  put(entry: WatchEntry): void
}

export interface DepositWatcherDeps {
  /** The bridge's recent deposits to an account's address on a chain. */
  recent: (account: string, bridge: string) => Promise<BridgeDeposit[] | null>
  /** An address's balance of a token on a Zerion chain; zero when it holds none, null when it can't be read. */
  balance: (address: string, zerion: string, symbol: string) => Promise<{ raw: bigint; decimals: number } | null>
  /** Told each time a deposit moves on, with where it stood before. */
  onUpdate: (entry: WatchEntry, before: DepositProgress['stage']) => void
  journal?: DepositJournal
  now?: () => number
  wait?: (ms: number) => Promise<void>
}

const ACTIVE: ReadonlySet<DepositProgress['stage']> = new Set(['watching', 'seen'])

const STAGES: Record<BridgeDeposit['status'], DepositProgress['stage']> = { PENDING: 'seen', CREDITED: 'credited', COMPLETED: 'credited', FAILED: 'failed' }

/** What to watch for, from what main worked out for the card. */
export type WatchAsk = Omit<WatchEntry, 'before' | 'baseline' | 'startedAt' | 'deposit'> & { deposit: Omit<ChatDeposit, 'progress'> }

/**
 * Watches the addresses deposit cards show, until something arrives or a day passes.
 * NEAR Intents' address: the bridge's recent deposits, ignoring the ones it listed
 * before the card, and following the first new one for the token until it's credited
 * or not. The wallet's own address: its balance of the token, until it goes up. With
 * a journal, each is kept across restarts and picked up again by `resume`.
 */
export function createDepositWatcher({ recent, balance, onUpdate, journal, now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }: DepositWatcherDeps) {
  const entries = new Map<string, WatchEntry>()
  const running = new Set<string>()

  const all = (): WatchEntry[] => {
    for (const entry of journal?.list() ?? []) if (!entries.has(entry.deposit.id)) entries.set(entry.deposit.id, entry)
    return [...entries.values()]
  }

  const keep = (entry: WatchEntry) => {
    entries.set(entry.deposit.id, entry)
    journal?.put(entry)
  }

  const move = (entry: WatchEntry, progress: DepositProgress) => {
    const was = entry.deposit.progress
    if (was.stage === progress.stage && was.got === progress.got && was.tx === progress.tx && was.until === progress.until) return
    entry.deposit = { ...entry.deposit, progress }
    keep(entry)
    onUpdate(entry, was.stage)
  }

  /** One look at the bridge or the balance. */
  async function look(entry: WatchEntry): Promise<void> {
    const { deposit } = entry
    if (deposit.kind === 'intents' && deposit.account && entry.bridge) {
      const listed = await recent(deposit.account, entry.bridge).catch(() => null)
      if (!listed) return
      const mine = listed.filter((each) => entry.assetIds.includes(each.assetId))
      if (entry.before === null) {
        entry.before = mine.map((each) => each.tx)
        keep(entry)
        return
      }
      const followed = deposit.progress.tx
      const found = followed ? mine.find((each) => each.tx === followed) : mine.find((each) => !entry.before?.includes(each.tx))
      if (!found) return
      const stage = STAGES[found.status]
      const page = txPage(deposit.chain, found.tx)
      // Seen, it's followed for another day, however long the wait before.
      const until = deposit.progress.stage === 'watching' ? now() + WATCH_MS : deposit.progress.until
      move(entry, { stage, got: `${formatUnits(found.amount, found.decimals)} ${deposit.asset}`, tx: found.tx, link: page?.url ?? null, until })
      return
    }
    if (deposit.kind === 'own' && entry.zerion) {
      const held = await balance(deposit.address, entry.zerion, deposit.asset).catch(() => null)
      if (!held) return
      if (entry.baseline === null) {
        entry.baseline = held.raw.toString()
        keep(entry)
        return
      }
      const more = held.raw - BigInt(entry.baseline)
      if (more > 0n) move(entry, { stage: 'credited', got: `${formatUnits(more, held.decimals)} ${deposit.asset}`, tx: null, link: null, until: deposit.progress.until })
    }
  }

  /** Watches one deposit until it settles or Ink stops. One loop for each at a time. */
  async function run(entry: WatchEntry): Promise<void> {
    const id = entry.deposit.id
    if (running.has(id)) return
    running.add(id)
    try {
      const every = entry.deposit.kind === 'intents' ? BRIDGE_POLL_MS : BALANCE_POLL_MS
      while (ACTIVE.has(entry.deposit.progress.stage)) {
        if (now() > entry.deposit.progress.until) {
          // A deposit already seen keeps its transaction, so the card can say NEAR Intents still credits it.
          move(entry, { ...entry.deposit.progress, stage: 'stopped' })
          break
        }
        await look(entry)
        if (!ACTIVE.has(entry.deposit.progress.stage)) break
        await wait(every)
      }
    } finally {
      running.delete(id)
    }
  }

  const watchable = (ask: WatchAsk) => (ask.deposit.kind === 'intents' ? Boolean(ask.deposit.account && ask.bridge && ask.assetIds.length > 0) : Boolean(ask.zerion))

  return {
    /**
     * Starts watching the address a card shows, or gives the card already watching it
     * when the same chat asked for the same token at the same address.
     */
    watch(ask: WatchAsk): WatchEntry {
      const same = all().find(
        (entry) => entry.owner === ask.owner && ACTIVE.has(entry.deposit.progress.stage) && entry.deposit.chain === ask.deposit.chain && entry.deposit.asset === ask.deposit.asset && entry.deposit.address === ask.deposit.address,
      )
      if (same) return same
      const stage = watchable(ask) ? 'watching' : 'unwatched'
      const entry: WatchEntry = { ...ask, deposit: { ...ask.deposit, progress: { stage, got: null, tx: null, link: null, until: now() + WATCH_MS } }, before: null, baseline: null, startedAt: now() }
      keep(entry)
      if (stage === 'watching') void run(entry)
      return entry
    },

    /** Watches a card's address for another day, once Ink stopped. Null for one it can't. */
    again(id: string): WatchEntry | null {
      const entry = all().find((each) => each.deposit.id === id)
      if (!entry || entry.deposit.progress.stage !== 'stopped') return null
      move(entry, { stage: 'watching', got: null, tx: null, link: null, until: now() + WATCH_MS })
      void run(entry)
      return entry
    },

    /** Picks up the watches a restart cut off. */
    resume(): void {
      for (const entry of all()) if (ACTIVE.has(entry.deposit.progress.stage)) void run(entry)
    },

    get: (id: string): WatchEntry | null => all().find((entry) => entry.deposit.id === id) ?? null,
  }
}

export type DepositWatcher = ReturnType<typeof createDepositWatcher>
