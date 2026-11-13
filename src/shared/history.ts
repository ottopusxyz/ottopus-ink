import type { AgentId, ChatEvent } from './ipc'

/**
 * A chat as Ink keeps it across restarts: Ink's own record of what was said and what
 * became of each plan, the same whichever agent wrote it. Main records it from the
 * events it already passes to the page, never from the page's word.
 */
export type SavedEvent =
  /** The person's own message. */
  | { type: 'you'; text: string }
  /** The chat went on after a restart, in a new session with this agent. */
  | { type: 'continued'; agent: AgentId; at: number }
  | Extract<ChatEvent, { type: 'text' | 'tool-call' | 'tool-result' | 'plan' | 'plan-status' | 'plan-swap' | 'plan-note' | 'deposit' | 'deposit-progress' | 'deposit-note' }>

export interface SavedChat {
  /** The page's id for the chat, kept across the sessions it runs in. */
  id: string
  /** The agent it was last with. */
  agent: AgentId
  /** The message that began it, which names it. */
  opening: string
  startedAt: number
  updatedAt: number
  events: SavedEvent[]
}

/** Which events are kept: what was said, and what became of each plan and deposit. Session reports, lock checks and turn ends aren't. */
export const SAVED_EVENT_TYPES: ReadonlySet<SavedEvent['type']> = new Set(['you', 'continued', 'text', 'tool-call', 'tool-result', 'plan', 'plan-status', 'plan-swap', 'plan-note', 'deposit', 'deposit-progress', 'deposit-note'])

/** A chat id as the page makes them. */
export const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
