export type ChatStatus = 'idle' | 'live' | 'settled'

export interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  text: string
}

export interface Chat {
  id: string
  title: string
  status: ChatStatus
  /** A live plan's position, such as "2 of 3". */
  step?: string
  messages: ChatMessage[]
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
