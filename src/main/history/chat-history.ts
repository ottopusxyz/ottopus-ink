import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { AGENT_IDS, type AgentId, type ChatEvent, type ChatPlan, type ChatSwap, type InkNote } from '../../shared/ipc'
import { CHAT_ID, SAVED_EVENT_TYPES, type SavedChat, type SavedEvent } from '../../shared/history'
import { PLAN_STATUSES } from '../../shared/plan'
import type { SecretBox } from '../external/sign-ins'

/** Chats kept, newest first. */
export const HISTORY_KEEP = 30
/** Events kept for each chat; the oldest make way. Like the page's own limit. */
export const HISTORY_EVENTS = 1000
/** Longer than anyone types, and than any reply or tool call worth keeping whole. */
const MAX_TEXT = 20_000
/** Tool results are kept short: what a tool returned is the agent's to see, not the person's record. */
const MAX_TOOL_TEXT = 2_000
/** How long after a change the file is written, so a streaming reply doesn't write it on every chunk. */
export const HISTORY_WRITE_MS = 1_000

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)
const isText = (value: unknown, max = MAX_TEXT + 1): value is string => typeof value === 'string' && value.length <= max
const isAgent = (value: unknown): value is AgentId => typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value)
const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const nullableText = (value: unknown) => value === null || isText(value)

function isPlan(value: unknown): value is ChatPlan {
  const plan = record(value)
  if (!plan || !isText(plan.id, 64) || !(PLAN_STATUSES as readonly string[]).includes(plan.status as string)) return false
  if (!['send', 'swap', 'stake'].includes(plan.outcome as string) || !isText(plan.asset, 300) || !isText(plan.amount, 300)) return false
  return ['chain', 'to', 'toAsset', 'toChain'].every((field) => nullableText(plan[field]))
}

function isSwap(value: unknown): value is ChatSwap {
  const swap = record(value)
  return (
    swap !== null &&
    ['deposited', 'swapping', 'done', 'refunded', 'failed', 'unknown'].includes(swap.stage as string) &&
    nullableText(swap.got) &&
    nullableText(swap.refunded) &&
    (swap.link === null || (isText(swap.link, 300) && swap.link.startsWith('https://')))
  )
}

function isNote(value: unknown): value is InkNote {
  const note = record(value)
  if (!note || !['ok', 'block', 'info'].includes(note.tone as string) || !isText(note.title, 300) || !Array.isArray(note.lines) || !Array.isArray(note.links)) return false
  return note.lines.every((line) => isText(line)) && note.links.every((link) => isText(record(link)?.label, 300) && isText(record(link)?.url, 300) && (record(link)?.url as string).startsWith('https://'))
}

/** One kept event, only in the shape this version writes. Anything else is dropped, not trusted. */
function eventOf(value: unknown): SavedEvent | null {
  const event = record(value)
  if (!event || !SAVED_EVENT_TYPES.has(event.type as SavedEvent['type'])) return null
  switch (event.type) {
    case 'you':
    case 'text':
      return isText(event.text) ? ({ type: event.type, text: event.text } as SavedEvent) : null
    case 'continued':
      return isAgent(event.agent) && typeof event.at === 'number' ? { type: 'continued', agent: event.agent, at: event.at } : null
    case 'tool-call':
      return isText(event.id, 200) && isText(event.name, 200) && isText(event.input) ? { type: 'tool-call', id: event.id, name: event.name, input: event.input } : null
    case 'tool-result':
      return isText(event.id, 200) && isText(event.text) && typeof event.isError === 'boolean' ? { type: 'tool-result', id: event.id, text: event.text, isError: event.isError } : null
    case 'plan':
      return isPlan(event.plan) ? { type: 'plan', plan: event.plan } : null
    case 'plan-status':
      return isText(event.id, 64) && (PLAN_STATUSES as readonly string[]).includes(event.status as string) && (event.transactionId === undefined || isText(event.transactionId, 128))
        ? ({ type: 'plan-status', id: event.id, status: event.status, ...(event.transactionId === undefined ? {} : { transactionId: event.transactionId }) } as SavedEvent)
        : null
    case 'plan-swap':
      return isText(event.id, 64) && isSwap(event.swap) ? { type: 'plan-swap', id: event.id, swap: event.swap } : null
    case 'plan-note':
      return isText(event.id, 64) && isNote(event.note) ? { type: 'plan-note', id: event.id, note: event.note } : null
    default:
      return null
  }
}

function chatOf(value: unknown): SavedChat | null {
  const chat = record(value)
  if (!chat || typeof chat.id !== 'string' || !CHAT_ID.test(chat.id) || !isAgent(chat.agent) || !isText(chat.opening) || typeof chat.startedAt !== 'number' || typeof chat.updatedAt !== 'number' || !Array.isArray(chat.events)) return null
  return { id: chat.id, agent: chat.agent, opening: chat.opening, startedAt: chat.startedAt, updatedAt: chat.updatedAt, events: chat.events.map(eventOf).filter((event): event is SavedEvent => event !== null) }
}

/** An event as it's kept: only the ones worth keeping, trimmed. Null for one that isn't. */
export function savedEventOf(event: ChatEvent | Extract<SavedEvent, { type: 'you' | 'continued' }>): SavedEvent | null {
  if (!SAVED_EVENT_TYPES.has(event.type as SavedEvent['type'])) return null
  if (event.type === 'tool-result') return { ...event, text: clip(event.text, MAX_TOOL_TEXT) }
  if (event.type === 'tool-call') return { ...event, input: clip(event.input, MAX_TOOL_TEXT) }
  if (event.type === 'text' || event.type === 'you') return { ...event, text: clip(event.text, MAX_TEXT) }
  return event as SavedEvent
}

export interface ChatHistory {
  /** Newest first. */
  list(): SavedChat[]
  get(id: string): SavedChat | null
  /** Starts keeping a chat, or picks up one kept before, now with this agent. */
  begin(id: string, agent: AgentId, opening: string): void
  /** Adds what happened in a chat. A reply's pieces join into one. */
  record(id: string, event: SavedEvent): void
  remove(id: string): void
  clear(): void
  /** Writes now, as when Ink quits. */
  flush(): void
}

/**
 * Chats kept across restarts. They hold what was said, addresses and amounts, so they're
 * kept like the saved portfolio: encrypted by the OS keyring, or in memory for this run
 * only where there is none. Main hands them out only while the vault is unlocked.
 */
export function createChatHistory({ file, box, now = Date.now, schedule = (write) => setTimeout(write, HISTORY_WRITE_MS) }: { file: string; box: SecretBox; now?: () => number; schedule?: (write: () => void) => unknown }): ChatHistory {
  let chats: SavedChat[] | null = null
  let pending = false

  const load = (): SavedChat[] => {
    if (!box.canKeep()) return []
    try {
      const parsed: unknown = JSON.parse(box.open(readFileSync(file)))
      return Array.isArray(parsed) ? parsed.map(chatOf).filter((chat): chat is SavedChat => chat !== null).slice(0, HISTORY_KEEP) : []
    } catch {
      return []
    }
  }
  const all = (): SavedChat[] => (chats ??= load())

  const write = () => {
    pending = false
    if (!box.canKeep() || !chats) return
    try {
      const temporary = `${file}.${randomUUID()}`
      writeFileSync(temporary, box.seal(JSON.stringify(chats)), { mode: 0o600 })
      renameSync(temporary, file)
    } catch {
      // Not kept on disk this time; the copy in memory still serves this run.
    }
  }
  const later = () => {
    if (pending) return
    pending = true
    schedule(write)
  }

  return {
    list: () => [...all()],
    get: (id) => all().find((chat) => chat.id === id) ?? null,
    begin(id, agent, opening) {
      if (!CHAT_ID.test(id)) return
      const kept = all().find((chat) => chat.id === id)
      const chat = kept ? { ...kept, agent, updatedAt: now() } : { id, agent, opening: clip(opening, MAX_TEXT), startedAt: now(), updatedAt: now(), events: [] }
      chats = [chat, ...all().filter((other) => other.id !== id)].slice(0, HISTORY_KEEP)
      later()
    },
    record(id, event) {
      const chat = all().find((kept) => kept.id === id)
      if (!chat) return
      const last = chat.events.at(-1)
      if (event.type === 'text' && last?.type === 'text') chat.events[chat.events.length - 1] = { type: 'text', text: clip(last.text + event.text, MAX_TEXT) }
      else chat.events.push(event)
      if (chat.events.length > HISTORY_EVENTS) chat.events.splice(0, chat.events.length - HISTORY_EVENTS)
      chat.updatedAt = now()
      later()
    },
    remove(id) {
      chats = all().filter((chat) => chat.id !== id)
      write()
    },
    clear() {
      chats = []
      rmSync(file, { force: true })
    },
    flush: () => {
      if (pending) write()
    },
  }
}
