import { randomBytes, randomInt } from 'node:crypto'
import { entropyToMnemonic, mnemonicToEntropy, mnemonicToSeed, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type BackupAnswer, type VaultFailure, type VaultRequest, type VaultResult, type VaultWordCount } from '../shared/vault'
import type { Account } from '../shared/accounts'
import type { PlanCore } from '../shared/plan'
import { planHash } from '../shared/plan-hash'
import { deriveAccounts } from './accounts'
import { signSteps, SignRefusal } from './sign'
import { DEFAULT_LOG_N, openEntropy, sealEntropy, VaultCryptoError } from './vault-crypto'

const BACKUP_CHECKS = 3
const ENTROPY_BYTES: Record<VaultWordCount, number> = { 12: 16, 24: 32 }

const fail = (reason: VaultFailure) => ({ ok: false, reason }) as const
const done = <T extends object>(value: T): VaultResult<object> => ({ ok: true, ...value })

/** Whether the plan hashes to the approved hash. A plan that can't be hashed at all isn't the approved one either. */
function sameHash(plan: unknown, hash: unknown): boolean {
  try {
    return typeof hash === 'string' && planHash(plan as PlanCore) === hash
  } catch {
    return false
  }
}

const cleanWord = (word: string) => word.normalize('NFKD').trim().toLowerCase()

/** Whole characters, not UTF-16 units, so a long emoji password isn't counted as longer than it is. */
const passwordFits = (password: string) => {
  const length = [...password.normalize('NFKC')].length
  return length >= MIN_PASSWORD_LENGTH && length <= MAX_PASSWORD_LENGTH
}

function chooseChecks(words: number): number[] {
  const chosen = new Set<number>()
  while (chosen.size < BACKUP_CHECKS) chosen.add(randomInt(words))
  return [...chosen].sort((a, b) => a - b)
}

interface Pending {
  entropy: Uint8Array
  /** The words the person must give back, or null for a phrase they typed in themselves. */
  check: number[] | null
}

export interface VaultStateOptions {
  /** Lower only in tests, where the real cost would take minutes. A vault below this is refused. */
  logN?: number
}

/**
 * What the signer knows about the vault. This is the only code that sees a seed
 * outside encryption. Bytes are wiped when finished with. The phrase itself passes
 * through strings while being shown or typed, and JavaScript can't wipe those.
 */
export function createVaultState({ logN = DEFAULT_LOG_N }: VaultStateOptions = {}) {
  let unlocked: Uint8Array | null = null
  let pending: Pending | null = null
  /** Public, worked out once per unlock. */
  let accounts: Account[] | null = null
  /** Moves on with every lock, so work that started before one can't finish after it. */
  let locks = 0

  const dropPending = () => {
    pending?.entropy.fill(0)
    pending = null
  }

  const lock = () => {
    locks++
    unlocked?.fill(0)
    unlocked = null
    accounts = null
    dropPending()
  }

  const answersMatch = (entropy: Uint8Array, check: number[], answers: BackupAnswer[]) => {
    const words = entropyToMnemonic(entropy, wordlist).split(' ')
    return check.every((index) => answers.some((answer) => answer.index === index && cleanWord(answer.word) === words[index]))
  }

  const run = async (request: VaultRequest): Promise<VaultResult<object>> => {
    switch (request.op) {
      case 'begin-create': {
        if (request.words !== 12 && request.words !== 24) return fail('bad-input')
        dropPending()
        const entropy = Uint8Array.from(randomBytes(ENTROPY_BYTES[request.words]))
        const check = chooseChecks(request.words)
        pending = { entropy, check }
        return done({ words: entropyToMnemonic(entropy, wordlist).split(' '), check })
      }
      case 'begin-restore': {
        const words = request.words.split(/\s+/).map(cleanWord).filter(Boolean)
        const phrase = words.join(' ')
        if ((words.length !== 12 && words.length !== 24) || !validateMnemonic(phrase, wordlist)) return fail('invalid-words')
        dropPending()
        pending = { entropy: mnemonicToEntropy(phrase, wordlist), check: null }
        return { ok: true }
      }
      case 'finish': {
        const started = pending
        if (!started) return fail('nothing-pending')
        if (!passwordFits(request.password)) return fail('weak-password')
        if (started.check && !answersMatch(started.entropy, started.check, request.answers)) return fail('backup-mismatch')
        const blob = await sealEntropy(started.entropy, request.password, logN)
        return pending === started ? done({ blob }) : fail('nothing-pending')
      }
      case 'cancel':
        dropPending()
        return { ok: true }
      case 'unlock': {
        const before = locks
        const entropy = await openEntropy(request.blob, request.password, logN)
        if (locks !== before) {
          entropy.fill(0)
          return fail('locked-meanwhile')
        }
        unlocked?.fill(0)
        unlocked = entropy
        accounts = null
        dropPending()
        return { ok: true }
      }
      case 'lock':
        lock()
        return { ok: true }
      case 'accounts': {
        const entropy = unlocked
        if (!entropy) return fail('locked')
        if (!accounts) {
          const before = locks
          const seed = await mnemonicToSeed(entropyToMnemonic(entropy, wordlist))
          try {
            // Only a lock matters. Unlocking again opens the same file, so these are still its accounts.
            if (locks !== before) return fail('locked')
            accounts = deriveAccounts(seed)
          } finally {
            seed.fill(0)
          }
        }
        return done({ accounts })
      }
      case 'sign': {
        const entropy = unlocked
        if (!entropy) return fail('locked')
        if (!sameHash(request.plan, request.hash)) return fail('plan-mismatch')
        const before = locks
        const seed = await mnemonicToSeed(entropyToMnemonic(entropy, wordlist))
        try {
          // Signing itself runs in one go, so a lock can only land while the seed is worked out.
          if (locks !== before) return fail('locked')
          return done({ signed: signSteps(seed, request.plan.steps, request.live) })
        } catch (error) {
          if (error instanceof SignRefusal) return fail('refused')
          throw error
        } finally {
          seed.fill(0)
        }
      }
    }
  }

  return {
    /** Never rejects, and never passes on an error's text, which could quote what it was given. */
    async handle(request: VaultRequest): Promise<VaultResult<object>> {
      try {
        return await run(request)
      } catch (error) {
        return fail(error instanceof VaultCryptoError ? error.reason : 'bad-input')
      }
    },
    isUnlocked: () => unlocked !== null,
    isPending: () => pending !== null,
  }
}
