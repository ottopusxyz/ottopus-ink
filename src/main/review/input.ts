import { isAppUrl } from '../security'

/**
 * The review window's checks that don't need Electron itself, so they can be
 * tested: who may call the review channels, which input counts as a person
 * approving, and which links the window may open.
 */

/** An IPC call as Electron describes its sender. */
export interface Caller {
  sender: unknown
  senderFrame: { url: string } | null
}

/**
 * Whether a call comes from the review window's own top frame, on the review
 * page. The chat's page, a frame inside the review page, or the review window
 * after it was sent somewhere else, are all refused.
 */
export function isReviewCaller({ sender, senderFrame }: Caller, review: { mainFrame: unknown } | null, entry: string): boolean {
  // With no review window, review is null, and no sender is.
  return sender === review && senderFrame !== null && senderFrame === review?.mainFrame && isAppUrl(senderFrame.url, entry)
}

/** A mouse event as Electron's `input-event` reports it. */
export interface MouseInput {
  type: string
  button?: string
}

/** A key event as Electron's `before-input-event` reports it. */
export interface KeyInput {
  type: string
  key: string
  isAutoRepeat: boolean
}

/**
 * A press of the main mouse button. Electron reports these from the OS, so a
 * script in the page can't make one: `click()` and `dispatchEvent` never reach
 * here. Only the press counts: a release would let a press from before the
 * window armed approve, or one press approve twice.
 */
export const isApprovalClick = (input: MouseInput): boolean => input.type === 'mouseDown' && input.button === 'left'

/** A press of Enter or Space, which press a focused button. Not its release, and not a key held down. */
export const isApprovalKey = (input: KeyInput): boolean => input.type === 'keyDown' && !input.isAutoRepeat && (input.key === 'Enter' || input.key === ' ')

/** A NEAR transaction id: 32 bytes in base58. */
const TRANSACTION_ID = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/

/** Where the review window links a sent transaction. */
export const explorerUrl = (transactionId: string): string => `https://nearblocks.io/txns/${transactionId}`

/** The only links the review window opens: a transaction on the explorer, in the OS browser. */
export function isExplorerUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    const id = url.pathname.slice('/txns/'.length)
    // Rebuilt from the id alone, so a user, port, query or fragment can't ride along.
    return TRANSACTION_ID.test(id) && url.href === explorerUrl(id)
  } catch {
    return false
  }
}
