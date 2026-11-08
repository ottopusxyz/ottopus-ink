import type { AccountChain } from '../../../shared/accounts'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type BackupAnswer, type VaultFailure } from '../../../shared/vault'

/** What each chain's address is for, and anything to know before sending to it the first time. */
export const CHAIN_INFO: Record<AccountChain, { name: string; note: string }> = {
  near: { name: 'NEAR', note: 'Also your NEAR Intents account. It appears on NEAR with the first transfer in.' },
  evm: {
    name: 'Ethereum and EVM chains',
    note: 'The same address on Base, Ethereum, Arbitrum and other EVM chains. Check which network the sender uses.',
  },
  solana: { name: 'Solana', note: 'For SOL and Solana tokens.' },
  bitcoin: { name: 'Bitcoin', note: 'Native SegWit. Send bitcoin only.' },
  tron: { name: 'Tron', note: 'A new Tron address starts working once it receives TRX, so send about 1 TRX first.' },
  sui: { name: 'Sui', note: 'For SUI and Sui tokens.' },
  aptos: { name: 'Aptos', note: 'It appears on Aptos with the first transfer in.' },
}

/** What a person sees when a vault action fails. Each says what to do next. */
const MESSAGES: Record<VaultFailure, string> = {
  'bad-input': 'Something in that form wasn’t right. Check it and try again.',
  busy: 'Ink is still finishing the last step. Try again in a moment.',
  exists: 'There’s already a wallet on this computer, and Ink won’t replace it.',
  'no-vault': 'There’s no wallet on this computer yet.',
  'nothing-pending': 'This setup was cancelled or Ink locked, so those words won’t open a wallet. Cross them out, then start again.',
  'weak-password': `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
  'invalid-words': 'These aren’t a valid 12 or 24 word recovery phrase. Check each word and their order.',
  'backup-mismatch': 'Those words don’t match. Check them against what you wrote down.',
  'wrong-password': 'That password didn’t open the wallet.',
  damaged: 'The wallet file on this computer can’t be read.',
  'keyring-unavailable': 'Your system keyring can’t open the wallet right now. Unlock your keyring, or log in again, then try again.',
  'locked-meanwhile': 'Ink locked while this was running. Try again.',
  'write-failed': 'Ink couldn’t save the wallet. Check there’s free disk space, then try again.',
  'signer-stopped': 'The signing process stopped. Try again.',
  locked: 'Unlock Ink first.',
}

export const vaultMessage = (reason: VaultFailure): string => MESSAGES[reason]

/** Shown when a lock or a stopped signer throws away the phrase on screen. */
export const PHRASE_DROPPED = 'Ink locked, so the words it showed you were thrown away and won’t open a wallet. Cross them out, then start again.'

/** The setup steps that show, check or save a phrase the signer is holding. */
const HOLDS_PHRASE = new Set(['words', 'check', 'password'])

/**
 * Whether the phrase this setup step is about was just thrown away: main said a
 * phrase was waiting and now says none is, while the step still relies on it.
 */
export const phraseDropped = (wasWaiting: boolean, nowWaiting: boolean, step: string): boolean =>
  wasWaiting && !nowWaiting && HOLDS_PHRASE.has(step)

/** Counted the way the signer counts, in whole characters after normalising. */
const passwordLength = (password: string) => [...password.normalize('NFKC')].length

/** Why a new password can't be used yet, or null when it can. */
export function passwordProblem(password: string, confirm: string): string | null {
  const length = passwordLength(password)
  if (length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters. This one has ${length}.`
  if (length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`
  if (password !== confirm) return 'The two passwords don’t match.'
  return null
}

/** The words of a typed phrase, cleaned the way the signer cleans them. */
export const phraseWords = (text: string): string[] =>
  text
    .normalize('NFKD')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

/** Why a typed phrase can't be tried yet, or null. Whether it's a real phrase is the signer's call. */
export function phraseProblem(text: string): string | null {
  const count = phraseWords(text).length
  if (count === 12 || count === 24) return null
  return `A recovery phrase has 12 or 24 words. This has ${count}.`
}

/**
 * What the person typed for each asked-for word, as the signer's backup check takes it.
 * The signer compares these with the phrase it holds, so they must be the person's own
 * words: answers rebuilt from the phrase on the page would always pass.
 */
export const typedAnswers = (check: readonly number[], typed: Readonly<Record<number, string>>): BackupAnswer[] =>
  check.map((index) => ({ index, word: typed[index] ?? '' }))

/** Which of the asked-for words were typed wrong, by their position in the phrase. */
export function wrongAnswers(words: readonly string[], typed: Readonly<Record<number, string>>): number[] {
  return Object.keys(typed)
    .map(Number)
    .filter((index) => phraseWords(typed[index] ?? '').join(' ') !== words[index])
}

/**
 * An address split so its start and end stand out, the parts a person compares
 * after pasting. Malware that swaps a copied address usually can't match both.
 */
export function addressParts(address: string, edge = 6): { start: string; middle: string; end: string } {
  if (address.length <= edge * 2) return { start: address, middle: '', end: '' }
  return { start: address.slice(0, edge), middle: address.slice(edge, -edge), end: address.slice(-edge) }
}
