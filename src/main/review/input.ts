/**
 * The review window's checks that don't need Electron itself, so they can be
 * tested: which input counts as a person approving, and which links the window
 * may open.
 */

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
 * here.
 */
export const isApprovalClick = (input: MouseInput): boolean => (input.type === 'mouseDown' || input.type === 'mouseUp') && input.button === 'left'

/** Enter or Space, which press a focused button. A key held down doesn't count again. */
export const isApprovalKey = (input: KeyInput): boolean => (input.type === 'keyDown' || input.type === 'keyUp') && !input.isAutoRepeat && (input.key === 'Enter' || input.key === ' ')

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
