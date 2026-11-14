/** What main, the signer and the page agree on about the vault. Types and limits only: no secrets, no crypto. */

import type { Account } from './accounts'
import type { PlanCore } from './plan'

export type VaultWordCount = 12 | 24

export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 1024

export type VaultState = 'none' | 'locked' | 'unlocked'

export interface VaultStatus {
  state: VaultState
  /** Whether the vault is, or would be, also sealed with the OS keyring. A password is needed either way. */
  keyring: boolean
  /**
   * A new phrase is being shown and waits for its backup check and password. It goes
   * false when it's saved or cancelled, and when a lock or a stopped signer throws it
   * away, which is the page's cue that the words on screen no longer open anything.
   */
  phraseWaiting: boolean
}

export type VaultFailure =
  /** The page sent something that isn't the right shape. */
  | 'bad-input'
  /** Another vault action is still running. */
  | 'busy'
  /** There's already a vault here, and Ink won't write over one. */
  | 'exists'
  /** There's no vault to unlock. */
  | 'no-vault'
  /** Nothing is waiting to be saved: it was cancelled, or the app locked. */
  | 'nothing-pending'
  | 'weak-password'
  /** The words don't form a valid 12 or 24 word recovery phrase. */
  | 'invalid-words'
  /** The words given for the backup check aren't the right ones. */
  | 'backup-mismatch'
  /** The password is wrong, or the vault was changed since it was saved. Encryption can't tell which. */
  | 'wrong-password'
  /** The vault file can't be read as a vault. */
  | 'damaged'
  /** The vault is sealed with an OS keyring that can't open it right now. */
  | 'keyring-unavailable'
  /** The app locked while this was running, and locking wins. */
  | 'locked-meanwhile'
  | 'write-failed'
  | 'signer-stopped'
  /** This needs the vault unlocked. */
  | 'locked'
  /** The plan the signer was given isn't the one approved: its hash is different. */
  | 'plan-mismatch'
  /** The signer won't sign what the plan asks for: it isn't something the signer built and read back itself. */
  | 'refused'

export type VaultResult<T = object> = ({ ok: true } & T) | { ok: false; reason: VaultFailure }

/** A word the person gives to prove they wrote the phrase down. */
export interface BackupAnswer {
  index: number
  word: string
}

/** A new phrase to show once, and which of its words (from 0) the person must then give back. */
export interface NewPhrase {
  words: string[]
  check: number[]
}

/** What a step needs from the chain at the moment it's signed: the next nonce as a decimal, and a recent block hash as hex. */
/**
 * What the chain says just before a step is signed, as strings. A NEAR step takes its key's
 * next nonce and a recent block's hash; an EVM step its address's next nonce and today's fee
 * caps per unit of gas, in wei.
 */
export type LiveInputs = { nonce: string; blockHash: string } | { nonce: string; maxFeePerGas: string; maxPriorityFeePerGas: string } | { recentBlockhash: string }

/** A signed step: the bytes to send, and the transaction's id, which NEAR also calls its hash. */
export interface SignedStep {
  signed: Uint8Array
  transactionId: string
}

/** What main can ask the signer to do with the vault. */
export type VaultRequest =
  | { op: 'begin-create'; words: VaultWordCount }
  | { op: 'begin-restore'; words: string }
  | { op: 'finish'; password: string; answers: BackupAnswer[] }
  | { op: 'cancel' }
  | { op: 'unlock'; blob: string; password: string }
  | { op: 'lock' }
  | { op: 'accounts' }
  /**
   * Sign every step of a plan the person approved. The signer works out the
   * hash itself and refuses unless it's the approved one. Live holds, for each
   * step, what is fetched from the chain just before signing.
   */
  | { op: 'sign'; plan: PlanCore; hash: string; live: LiveInputs[] }

export type VaultOp = VaultRequest['op']

/** What each request answers with when it works. */
export interface VaultReplies {
  'begin-create': NewPhrase
  'begin-restore': object
  /** The password-encrypted vault, for main to keep. It stays useless without the password. */
  finish: { blob: string }
  cancel: object
  unlock: object
  lock: object
  /** The public address on each chain. No keys. */
  accounts: { accounts: Account[] }
  /** One signed transaction per step, in the plan's order. */
  sign: { signed: SignedStep[] }
}
