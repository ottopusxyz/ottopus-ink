import { INK_TOOLS, type AgentId, type ChatEvent, type ChatPlan } from '../../../shared/ipc'
import { NOTHING_SIGNED } from '@/components/ui/copy'

export type ChatStatus = 'idle' | 'live' | 'settled'

/** One row of a conversation. Everything but `user` holds what an untrusted agent sent, so it renders as text. */
export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'agent'; id: string; text: string }
  | { kind: 'tool'; id: string; toolId: string; name: string; input: string; result: { text: string; isError: boolean } | null }
  | { kind: 'plan'; id: string; plan: ChatPlan }
  /** `ends` marks the failure that finished a chat, which gets more room than one it can carry on from. */
  | { kind: 'notice'; id: string; severity: 'info' | 'block'; title: string; text: string | null; ends?: true }

/**
 * Where a chat's session is: starting up, waiting for the person, running a turn,
 * stopping one, or gone for good.
 */
export type ChatPhase = 'starting' | 'ready' | 'answering' | 'stopping' | 'ended'

export interface Chat {
  id: string
  title: string
  status: ChatStatus
  /** A live plan's position, such as "2 of 3". */
  step?: string
  agent: AgentId
  /** The main process's id for the session, once it has started. */
  sessionId: string | null
  phase: ChatPhase
  /** Unchecked until the agent reports its tools, which it does only after the first message. */
  lock: 'unchecked' | 'locked' | 'unlocked'
  items: ChatItem[]
  /** The newest plan, which outlives its row being dropped from a long chat. */
  plan: ChatPlan | null
  /** Whether the oldest items were dropped to stay under MAX_ITEMS. */
  trimmed: boolean
  /** The number in the next item's id. */
  nextItem: number
}

/** Enough for a very long chat, while an agent in a loop can't fill the window's memory. */
export const MAX_ITEMS = 1000
export const MAX_REPLY_CHARS = 200_000
export const MAX_TOOL_CHARS = 20_000

const clipped = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

type NewItem = ChatItem extends infer Item ? (Item extends ChatItem ? Omit<Item, 'id'> : never) : never

function withItem(chat: Chat, item: NewItem): Chat {
  const items = [...chat.items, { ...item, id: `item-${chat.nextItem}` } as ChatItem]
  const overflow = items.length - MAX_ITEMS
  return {
    ...chat,
    items: overflow > 0 ? items.slice(overflow) : items,
    trimmed: chat.trimmed || overflow > 0,
    nextItem: chat.nextItem + 1,
  }
}

/** A chat that is starting, with the message that started it. */
export function newChat(id: string, agent: AgentId, text: string): Chat {
  const chat: Chat = {
    id,
    title: chatTitle(text),
    status: 'idle',
    agent,
    sessionId: null,
    phase: 'starting',
    lock: 'unchecked',
    items: [],
    plan: null,
    trimmed: false,
    nextItem: 0,
  }
  return withItem(chat, { kind: 'user', text })
}

/** The session is up and has the first message. */
export function chatStarted(chat: Chat, sessionId: string): Chat {
  return { ...chat, sessionId, phase: 'answering' }
}

/** The person sent another message. */
export function messageSent(chat: Chat, text: string): Chat {
  return { ...withItem(chat, { kind: 'user', text }), phase: 'answering' }
}

/** An error, which often has no full stop, followed by what didn't happen. */
function withNothingSigned(error: string): string {
  return `${error}${/[.!?]$/.test(error) ? '' : '.'} ${NOTHING_SIGNED}`
}

export function chatFailedToStart(chat: Chat, error: string): Chat {
  return { ...withItem(chat, { kind: 'notice', severity: 'block', title: "Couldn't start the chat", text: withNothingSigned(error), ends: true }), phase: 'ended' }
}

/** A message didn't go through. If the chat has ended, its own event already said so. */
export function messageFailed(chat: Chat, error: string): Chat {
  if (chat.phase === 'ended') return chat
  return { ...withItem(chat, { kind: 'notice', severity: 'block', title: "Your message wasn't sent", text: withNothingSigned(error) }), phase: 'ready' }
}

/** What one event from the chat's session does to it. */
export function applyChatEvent(chat: Chat, event: ChatEvent): Chat {
  // Ending a chat takes a moment in the main process, and it stops here at once. The
  // exception is the lock: a person who pressed End must still hear that it broke.
  if (chat.phase === 'ended' && event.type !== 'lock') return chat
  switch (event.type) {
    case 'session':
    case 'subagent':
      return chat
    case 'lock':
      if (event.locked) return { ...chat, lock: chat.lock === 'unlocked' ? 'unlocked' : 'locked' }
      return {
        ...withItem(
          // What this agent proposed can't be left standing as if it were still good.
          { ...chat, items: chat.items.filter((item) => item.kind !== 'plan') },
          {
            kind: 'notice',
            severity: 'block',
            title: 'Ink stopped this chat',
            text: `The agent showed ${event.found.join(', ')}. Ink chats may only use Ottopus tools.${chat.plan ? ' Its plan was removed.' : ''}`,
          },
        ),
        plan: null,
        lock: 'unlocked',
      }
    case 'text': {
      const last = chat.items.at(-1)
      if (last?.kind !== 'agent') return withItem(chat, { kind: 'agent', text: clipped(event.text, MAX_REPLY_CHARS) })
      if (last.text.length > MAX_REPLY_CHARS) return chat
      return { ...chat, items: [...chat.items.slice(0, -1), { ...last, text: clipped(last.text + event.text, MAX_REPLY_CHARS) }] }
    }
    case 'tool-call':
      return withItem(chat, {
        kind: 'tool',
        toolId: event.id,
        name: event.name,
        input: clipped(event.input, MAX_TOOL_CHARS),
        result: null,
      })
    case 'tool-result':
      return {
        ...chat,
        items: chat.items.map((item) =>
          item.kind === 'tool' && item.toolId === event.id
            ? { ...item, result: { text: clipped(event.text, MAX_TOOL_CHARS), isError: event.isError } }
            : item,
        ),
      }
    case 'plan':
      return { ...withItem(chat, { kind: 'plan', plan: event.plan }), plan: event.plan }
    case 'turn-end':
      if (event.outcome === 'stopped') return { ...withItem(chat, { kind: 'notice', severity: 'info', title: 'Stopped', text: null }), phase: 'ready' }
      if (event.outcome === 'failed') {
        return { ...withItem(chat, { kind: 'notice', severity: 'block', title: 'The agent hit an error', text: event.error }), phase: 'ready' }
      }
      return { ...chat, phase: 'ready' }
    case 'ended': {
      // Being stopped for the lock already has its own notice.
      if (event.error === null || chat.lock === 'unlocked') return { ...chat, phase: 'ended' }
      return { ...withItem(chat, { kind: 'notice', severity: 'block', title: 'The chat ended', text: event.error, ends: true }), phase: 'ended' }
    }
  }
}

/** Whether a chat's agent is busy with something right now. */
export function isWorking({ phase }: Pick<Chat, 'phase'>): boolean {
  return phase === 'starting' || phase === 'answering' || phase === 'stopping'
}

/** What the status area says about a chat's lock, and how much it should worry anyone. */
export function lockStatus({ lock, phase }: Pick<Chat, 'lock' | 'phase'>): { text: string; hint: string; tone: 'ok' | 'plan' | 'block' | 'neutral' } {
  if (lock === 'unlocked') {
    return { text: 'Not locked, chat stopped', hint: 'The agent showed more than Ottopus tools, so Ink stopped the chat.', tone: 'block' }
  }
  if (phase === 'ended') return { text: 'Chat ended', hint: 'Nothing is running for this chat.', tone: 'neutral' }
  if (lock === 'locked') {
    return { text: 'Locked to Ottopus tools', hint: 'On its latest report, the agent had only Ottopus tools.', tone: 'ok' }
  }
  return { text: 'Lock not checked yet', hint: 'The agent reports its tools once it has your first message, and Ink checks them then.', tone: 'plan' }
}

const INK_TOOL_PREFIX = 'mcp__ottopus-ink__'

/**
 * A tool's name to show: Ink's real tools without the prefix, anything else in full
 * so it stands out. An agent can make up a name like `mcp__ottopus-ink__sign`.
 */
export function toolLabel(name: string): string {
  const short = name.slice(INK_TOOL_PREFIX.length)
  return name.startsWith(INK_TOOL_PREFIX) && INK_TOOLS.some((tool) => tool === short) ? short : name
}

/** A plan in one line, such as "Swap 0.1 ETH to USDC". */
export function planHeadline({ outcome, amount, asset, toAsset }: ChatPlan): string {
  const verb = `${outcome[0]?.toUpperCase() ?? ''}${outcome.slice(1)}`
  return `${verb} ${amount} ${asset}${toAsset ? ` to ${toAsset}` : ''}`
}

/** A rejected IPC call's message without Electron's wrapping around it. */
export function ipcErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

/** Longest title the sidebar shows before the label truncates anyway. */
export const TITLE_MAX = 48

/**
 * A chat's title from its first message: the first non-empty line, with runs
 * of whitespace collapsed, cut at a word boundary with an ellipsis.
 */
export function chatTitle(text: string, max = TITLE_MAX): string {
  const line =
    text
      .split('\n')
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .find((part) => part.length > 0) ?? ''
  if (line.length <= max) return line || 'New chat'
  const cut = line.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Unsent text by chat id, plus HOME_DRAFT for the home composer. */
export type Drafts = Readonly<Record<string, string>>

/** The home composer's key in Drafts. Chat ids are UUIDs, so it cannot clash. */
export const HOME_DRAFT = 'home'

/** Drafts with one key set, or removed when the text is empty. */
export function withDraft(drafts: Drafts, key: string, text: string): Drafts {
  if (text) return { ...drafts, [key]: text }
  if (!(key in drafts)) return drafts
  const rest = { ...drafts }
  delete rest[key]
  return rest
}

/** Chats whose title holds every word of the query, in any order and case. */
export function filterChats<T extends Pick<Chat, 'title'>>(chats: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...chats]
  return chats.filter((chat) => {
    const title = chat.title.toLowerCase()
    return words.every((word) => title.includes(word))
  })
}
