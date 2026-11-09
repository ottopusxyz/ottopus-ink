import type { ReviewFailure, ReviewState } from '../../../shared/review'

/**
 * The review window's words and small rules, apart from the page so they can
 * be tested. Main decides what can happen; these only say it.
 */

/**
 * An address in full, split into groups that are easier to compare by eye. A
 * hex account goes in groups of 8; a named account stays whole. Nothing is cut.
 */
export function groupAddress(address: string): string[] {
  const hex = /^(0x)?([0-9a-f]+)$/.exec(address)
  if (!hex || address.length < 40) return [address]
  const [, prefix = '', digits = ''] = hex
  const groups = digits.match(/.{1,8}/g) ?? [digits]
  return prefix ? [prefix, ...groups] : groups
}

/** The first and last 8 characters of the plan hash, to compare with what the agent reports. */
export const shortHash = (hash: string): string => (hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash)

/** Time left before the plan expires, as m:ss, or null once it's up. */
export function timeLeft(expiresAt: string, now: number): string | null {
  const left = Math.floor((Date.parse(expiresAt) - now) / 1000)
  if (!(left > 0)) return null
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

const FAILURES: Record<ReviewFailure, string> = {
  locked: 'Ink is locked. Unlock it in the main window, then approve again.',
  'not-armed': 'That was too quick after this window came up. Check the plan, then approve again.',
  'no-gesture': 'Approve with a click or the keyboard.',
  stale: 'This plan changed while you were looking. Check it again.',
  'fee-changed': 'The most the network fee could cost has changed. Nothing was signed. Check the new maximum, then approve again.',
  'cannot-move': 'This plan can’t be approved any more.',
  busy: 'Ink is sending another plan. Try again in a moment.',
  'wrong-network': 'The NEAR server Ink reached isn’t on mainnet, so Ink signed nothing.',
  'chain-unavailable': 'Ink couldn’t reach NEAR. Nothing was signed. Try again in a moment.',
  'insufficient-funds': 'Your NEAR balance no longer covers the amount and the fee. Nothing was signed.',
  'recipient-unknown': 'That account doesn’t exist on NEAR, so nothing sent to it would arrive. Nothing was signed.',
  'earlier-pending': 'An earlier send from this account hasn’t been answered yet. Try again once NEAR shows it.',
  'plan-mismatch': 'The signer worked out a different plan hash, so it signed nothing.',
  refused: 'The signer refused this plan. Nothing was sent.',
  'signer-stopped': 'The signer stopped. Nothing was sent.',
  'not-found': 'Ink no longer has this plan.',
  'bad-request': 'Ink can’t send this kind of plan.',
}

export const failureText = (reason: ReviewFailure): string => FAILURES[reason]

/** Whether the person can approve now. Main checks all of this again, and more. */
export function canApprove(state: ReviewState): boolean {
  return state.armed && state.unlocked && !state.sending && (state.status === 'awaiting_review' || state.status === 'approved')
}

/** Approve, or Try again for a plan already approved whose send stopped short of signing. */
export const approveLabel = (state: ReviewState): string => (state.status === 'approved' ? 'Try again' : 'Approve and send')

export interface Outcome {
  tone: 'ok' | 'info' | 'block' | 'caution'
  title: string
  text: string
}

/** What became of a plan that's past review, or null while it's still waiting on the person. */
export function outcomeOf(state: ReviewState): Outcome | null {
  if (state.sending) return { tone: 'info', title: 'Signing and sending…', text: 'Keep Ink open until NEAR answers.' }
  switch (state.status) {
    case 'confirmed':
      return { tone: 'ok', title: 'Sent', text: 'NEAR ran the transaction.' }
    case 'failed':
      return state.transactionId
        ? { tone: 'block', title: 'NEAR didn’t run it', text: 'The transaction was turned down or failed on chain. Any fee already used isn’t returned.' }
        : { tone: 'block', title: 'Not sent', text: state.failure ? failureText(state.failure) : 'Nothing was sent.' }
    case 'submitted':
      return { tone: 'caution', title: 'Sent, no answer yet', text: 'NEAR may still run it. Check the explorer before sending it again.' }
    case 'signing':
      return { tone: 'info', title: 'Signing…', text: 'The signer has it.' }
    case 'cancelled':
      return { tone: 'info', title: 'Cancelled', text: 'Nothing was signed.' }
    case 'expired':
      return { tone: 'info', title: 'Expired', text: 'Nobody approved it in time. Nothing was signed.' }
    case 'blocked':
      return { tone: 'block', title: 'Blocked', text: 'A safety rule refused this plan. Nothing was signed.' }
    default:
      return null
  }
}
