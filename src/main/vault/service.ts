import { ACCOUNT_CHAINS, type Account, type AccountChain } from '../../shared/accounts'
import { MAX_PASSWORD_LENGTH, type BackupAnswer, type NewPhrase, type VaultFailure, type VaultRequest, type VaultResult, type VaultStatus } from '../../shared/vault'
import { VaultStoreError, type VaultStore } from './store'

/** Longer than any real phrase, to stop a page sending the signer something huge. */
const MAX_PHRASE_LENGTH = 1024
const MAX_WORD_LENGTH = 32
const MAX_ANSWERS = 24

export interface VaultServiceOptions {
  store: VaultStore
  ask: (request: VaultRequest) => Promise<VaultResult<object>>
  onStatus: (status: VaultStatus) => void
}

export interface VaultService {
  status(): VaultStatus
  startCreate(words: unknown): Promise<VaultResult<NewPhrase>>
  finishCreate(password: unknown, answers: unknown): Promise<VaultResult>
  cancelCreate(): Promise<void>
  restore(words: unknown, password: unknown): Promise<VaultResult>
  unlock(password: unknown): Promise<VaultResult>
  lock(): Promise<void>
  /** The public address on each chain. Read only, so it doesn't wait behind other actions. */
  accounts(): Promise<VaultResult<{ accounts: Account[] }>>
  /** One chain's address, for main to copy. The chain comes from the page, so it's checked. */
  address(chain: unknown): Promise<VaultResult<{ address: string }>>
  isUnlocked(): boolean
  /** The signer went away, and took any seed with it. */
  signerStopped(): void
}

const fail = (reason: VaultFailure) => ({ ok: false, reason }) as const

const isPassword = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_PASSWORD_LENGTH * 4

function parseAnswers(value: unknown): BackupAnswer[] | null {
  if (!Array.isArray(value) || value.length > MAX_ANSWERS) return null
  const answers: BackupAnswer[] = []
  for (const item of value as unknown[]) {
    const { index, word } = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    if (typeof index !== 'number' || !Number.isInteger(index) || typeof word !== 'string' || word.length > MAX_WORD_LENGTH) return null
    answers.push({ index, word })
  }
  return answers
}

/**
 * The vault as main sees it: it moves encrypted bytes between the signer and the
 * file, and relays what the page sends after checking its shape. It never holds a
 * seed. The password and phrase pass through on their way to the signer only.
 */
export function createVaultService({ store, ask, onStatus }: VaultServiceOptions): VaultService {
  let unlocked = false
  let busy = false
  let phraseWaiting = false
  /** Moves on whenever the signer lets go of a new phrase: a lock, a stopped signer or a cancel. */
  let phraseDrops = 0
  /** Moves on with every lock, so an unlock answered just before one can't undo it. */
  let locks = 0

  const status = (): VaultStatus => ({
    state: !store.exists() ? 'none' : unlocked ? 'unlocked' : 'locked',
    keyring: store.usesKeyring(),
    phraseWaiting,
  })
  let last = JSON.stringify(status())
  const announce = () => {
    const now = status()
    const text = JSON.stringify(now)
    if (text === last) return
    last = text
    onStatus(now)
  }

  /** One at a time. Locking doesn't come through here, because it must never have to wait. */
  const oneAtATime = async <T extends object>(work: () => Promise<VaultResult<T>>): Promise<VaultResult<T>> => {
    if (busy) return fail('busy')
    busy = true
    try {
      return await work()
    } finally {
      busy = false
      announce()
    }
  }

  /** before is the lock count when the whole action began, so a lock at any point in it wins. */
  const openStored = async (password: string, before = locks): Promise<VaultResult> => {
    let blob: string
    try {
      blob = store.read()
    } catch (error) {
      return fail(error instanceof VaultStoreError && error.reason !== 'exists' ? error.reason : 'damaged')
    }
    const opened = await ask({ op: 'unlock', blob, password })
    if (!opened.ok) return opened
    if (locks !== before) return fail('locked-meanwhile')
    unlocked = true
    return { ok: true }
  }

  /** Saves what the signer is holding, then opens the saved copy, which proves it can be read before the person relies on it. */
  const save = async (password: string, answers: BackupAnswer[]): Promise<VaultResult> => {
    const before = locks
    const sealed = (await ask({ op: 'finish', password, answers })) as VaultResult<{ blob: string }>
    if (!sealed.ok) return sealed
    // A lock that landed while the answer was on its way has already wiped the signer. Saving now would unlock again.
    if (locks !== before) return fail('locked-meanwhile')
    try {
      store.write(sealed.blob)
    } catch (error) {
      return fail(error instanceof VaultStoreError && error.reason !== 'damaged' ? error.reason : 'write-failed')
    }
    const opened = await openStored(password, before)
    if (opened.ok) return opened
    if (opened.reason === 'wrong-password' || opened.reason === 'damaged' || opened.reason === 'keyring-unavailable') {
      // This is the file just written, and the signer still holds the seed, so nothing is lost by trying again.
      store.remove()
      return fail('write-failed')
    }
    return opened
  }

  /**
   * The read in progress, shared by everyone who asks meanwhile, so a burst sends the
   * signer one request. It belongs to one unlock: after a lock, a new read starts.
   */
  let reading: { locks: number; answer: Promise<VaultResult<{ accounts: Account[] }>> } | null = null
  const accounts = (): Promise<VaultResult<{ accounts: Account[] }>> => {
    if (!unlocked) return Promise.resolve(fail('locked'))
    if (reading && reading.locks === locks) return reading.answer
    const before = locks
    const asked = ask({ op: 'accounts' }) as Promise<VaultResult<{ accounts: Account[] }>>
    const answer = asked.then((result) => (locks === before ? result : fail('locked')))
    const current = { locks: before, answer }
    reading = current
    const done = () => {
      if (reading === current) reading = null
    }
    answer.then(done, done)
    return answer
  }

  return {
    status,
    isUnlocked: () => unlocked,

    startCreate: (words) =>
      oneAtATime<NewPhrase>(async () => {
        if (store.exists()) return fail('exists')
        if (words !== 12 && words !== 24) return fail('bad-input')
        const before = phraseDrops
        const begun = (await ask({ op: 'begin-create', words })) as VaultResult<NewPhrase>
        if (!begun.ok) return begun
        // A lock or cancel that landed while the answer was on its way has already wiped this
        // phrase in the signer. Showing it would have the person copy words that open nothing.
        if (phraseDrops !== before) return fail('locked-meanwhile')
        phraseWaiting = true
        // Only what the page needs, so nothing else the signer might add can reach it.
        return { ok: true, words: begun.words, check: begun.check }
      }),

    finishCreate: (password, answers) =>
      oneAtATime(async () => {
        const parsed = parseAnswers(answers)
        if (!isPassword(password) || !parsed) return fail('bad-input')
        if (store.exists()) return fail('exists')
        const saved = await save(password, parsed)
        // Saved, or already gone from the signer: either way no phrase waits any more.
        if (saved.ok || saved.reason === 'nothing-pending') phraseWaiting = false
        return saved
      }),

    async cancelCreate() {
      phraseDrops++
      phraseWaiting = false
      announce()
      await ask({ op: 'cancel' })
    },

    restore: (words, password) =>
      oneAtATime(async () => {
        if (typeof words !== 'string' || words.length > MAX_PHRASE_LENGTH || !isPassword(password)) return fail('bad-input')
        if (store.exists()) return fail('exists')
        const begun = await ask({ op: 'begin-restore', words })
        if (!begun.ok) return begun
        // The signer has let go of any new phrase to hold this one instead.
        phraseWaiting = false
        const saved = await save(password, [])
        // Unlike a new phrase, the person has this one and can type it again, so nothing should stay waiting.
        if (!saved.ok) await ask({ op: 'cancel' })
        return saved
      }),

    unlock: (password) =>
      oneAtATime(async () => {
        if (!isPassword(password)) return fail('bad-input')
        if (!store.exists()) return fail('no-vault')
        return openStored(password)
      }),

    async lock() {
      locks++
      unlocked = false
      // The signer forgets a waiting phrase when it locks, and the page has to hear that.
      phraseDrops++
      phraseWaiting = false
      announce()
      await ask({ op: 'lock' })
    },

    accounts,

    async address(chain) {
      if (typeof chain !== 'string' || !ACCOUNT_CHAINS.includes(chain as AccountChain)) return fail('bad-input')
      const answer = await accounts()
      if (!answer.ok) return answer
      const account = answer.accounts.find((each) => each.chain === chain)
      return account ? { ok: true, address: account.address } : fail('bad-input')
    },

    signerStopped() {
      locks++
      unlocked = false
      phraseDrops++
      phraseWaiting = false
      announce()
    },
  }
}
