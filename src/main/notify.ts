import type { InkNote } from '../shared/ipc'

/** A system notification, as the OS shows it. */
export interface Notice {
  title: string
  body: string
}

/** The most of a note's first line a notification shows: the chat has the rest. */
const MAX_BODY = 160

/**
 * The notification for a note Ink put in a chat: its title and first line while Ink is
 * unlocked. While it's locked, nothing about the money: the OS may show notifications
 * on the lock screen, to anyone at the computer.
 */
export function noticeOf(note: InkNote, unlocked: boolean): Notice {
  if (!unlocked) return { title: 'Ottopus Ink', body: note.tone === 'block' ? 'Something you started didn’t go through. Unlock Ink to see what happened.' : 'Something you started has finished. Unlock Ink to see it.' }
  const line = note.lines[0] ?? ''
  return { title: note.title, body: line.length > MAX_BODY ? `${line.slice(0, MAX_BODY - 1).trimEnd()}…` : line }
}

export interface NotifierDeps {
  /** Whether the OS can show notifications at all. */
  supported: () => boolean
  /** Whether one of Ink's own windows has focus, so the person sees the note there already. */
  focused: () => boolean
  unlocked: () => boolean
  /** Shows it; clicking it calls `open`. */
  show: (notice: Notice, open: () => void) => void
  /** Brings Ink's window forward. */
  open: () => void
}

/**
 * Tells the person, with a system notification, when something they started ends while
 * they're away from Ink: a plan sent, paid, refunded or failed, or a deposit landing.
 * Nothing while an Ink window has focus, where the chat shows it.
 */
export function createNotifier({ supported, focused, unlocked, show, open }: NotifierDeps): (note: InkNote) => void {
  return (note) => {
    if (!supported() || focused()) return
    show(noticeOf(note, unlocked()), open)
  }
}
