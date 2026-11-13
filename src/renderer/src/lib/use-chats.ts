import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentId, ChatEvent } from '../../../shared/ipc'
import { applyChatEvent, chatContinued, chatFailedToStart, chatStarted, ipcErrorText, messageFailed, messageSent, newChat, restoredChat, type Chat } from './chats'

/** Replies arrive a few characters at a time, so React draws them at this pace at most. */
const BATCH_MS = 50

/** Events held for a session whose start hasn't returned yet. */
const MAX_WAITING_EVENTS = 1000

export interface ChatActions {
  /** Starts a chat with its first message and returns the chat's id. */
  start(agent: AgentId, text: string): string
  send(chat: Chat, text: string): void
  stop(chat: Chat): void
  end(chat: Chat): void
  /** Goes on with a chat kept from before a restart, in a new session with the same agent. */
  continue(chat: Chat): void
  /** Drops an ended chat from the page and from what Ink keeps. */
  forget(chat: Chat): void
  /** Drops every ended chat, and everything Ink keeps. */
  clearHistory(): void
}

/**
 * The chats in this window and their sessions in the main process. Ink keeps each
 * chat's record, sealed, across restarts; the page gets the kept ones only while Ink is
 * unlocked, read-only until the person continues one, and drops them when it locks.
 */
export function useChats(): [Chat[], ChatActions] {
  const [chats, setChats] = useState<Chat[]>([])
  const chatIds = useRef(new Map<string, string>())
  // Each event with when it reached the page, so a tool call can say how long it took.
  const queue = useRef<[string, ChatEvent, number][]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const update = useCallback((id: string, change: (chat: Chat) => Chat) => {
    setChats((all) => all.map((chat) => (chat.id === id ? change(chat) : chat)))
  }, [])

  const flush = useCallback(() => {
    timer.current = null
    const ready = new Map<string, [ChatEvent, number][]>()
    const waiting: [string, ChatEvent, number][] = []
    for (const entry of queue.current) {
      const [sessionId, event, at] = entry
      const id = chatIds.current.get(sessionId)
      if (!id) {
        waiting.push(entry)
        continue
      }
      const events = ready.get(id)
      if (events) events.push([event, at])
      else ready.set(id, [[event, at]])
    }
    queue.current = waiting.slice(-MAX_WAITING_EVENTS)
    if (ready.size === 0) return
    setChats((all) =>
      all.map((chat) => ready.get(chat.id)?.reduce((next, [event, at]) => applyChatEvent(next, event, at), chat) ?? chat),
    )
  }, [])

  // Kept chats appear once Ink is unlocked, after any live ones, and go when it locks.
  useEffect(() => {
    let live = true
    const load = () =>
      void window.ink.savedChats().then(
        (saved) => {
          if (!live) return
          setChats((all) => {
            const here = new Set(all.map((chat) => chat.id))
            return [...all, ...saved.filter((kept) => !here.has(kept.id)).map(restoredChat)]
          })
        },
        () => undefined,
      )
    load()
    const off = window.ink.onVaultStatus((status) => {
      if (status.state === 'unlocked') load()
      else setChats((all) => all.filter((chat) => !chat.restored))
    })
    return () => {
      live = false
      off()
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.ink.onChatEvent((sessionId, event) => {
      queue.current.push([sessionId, event, Date.now()])
      timer.current ??= setTimeout(flush, BATCH_MS)
    })
    return () => {
      unsubscribe()
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
    }
  }, [flush])

  const actions = useMemo<ChatActions>(
    () => ({
      start(agent, text) {
        const id = crypto.randomUUID()
        setChats((all) => [newChat(id, agent, text), ...all])
        window.ink.startChat(agent, { historyId: id }).then(
          (sessionId) => {
            chatIds.current.set(sessionId, id)
            update(id, (chat) => chatStarted(chat, sessionId))
            flush()
            window.ink.sendToChat(sessionId, text).catch((error: unknown) => {
              update(id, (chat) => messageFailed(chat, ipcErrorText(error)))
            })
          },
          (error: unknown) => update(id, (chat) => chatFailedToStart(chat, ipcErrorText(error))),
        )
        return id
      },
      send(chat, text) {
        if (!chat.sessionId) return
        update(chat.id, (current) => messageSent(current, text))
        window.ink.sendToChat(chat.sessionId, text).catch((error: unknown) => {
          update(chat.id, (current) => messageFailed(current, ipcErrorText(error)))
        })
      },
      stop(chat) {
        if (!chat.sessionId) return
        update(chat.id, (current) => (current.phase === 'answering' ? { ...current, phase: 'stopping' } : current))
        // If the turn or the chat has just ended, its own event says so.
        window.ink.stopChatTurn(chat.sessionId).catch(() => undefined)
      },
      end(chat) {
        if (!chat.sessionId || chat.phase === 'ended') return
        update(chat.id, (current) => ({ ...current, phase: 'ended' }))
        window.ink.closeChat(chat.sessionId).catch(() => undefined)
      },
      continue(chat) {
        if (!chat.restored) return
        // Read-only until the new session is up, so nothing is sent twice.
        update(chat.id, (current) => ({ ...current, restored: false, phase: 'starting' }))
        window.ink.startChat(chat.agent, { historyId: chat.id, continue: true }).then(
          (sessionId) => {
            chatIds.current.set(sessionId, chat.id)
            update(chat.id, (current) => chatContinued(current, sessionId, chat.agent))
            flush()
          },
          (error: unknown) => update(chat.id, (current) => ({ ...chatFailedToStart(current, ipcErrorText(error)), restored: true })),
        )
      },
      forget(chat) {
        if (chat.phase !== 'ended') return
        setChats((all) => all.filter((other) => other.id !== chat.id))
        window.ink.deleteSavedChat(chat.id).catch(() => undefined)
      },
      clearHistory() {
        setChats((all) => all.filter((chat) => chat.phase !== 'ended'))
        window.ink.clearChatHistory().catch(() => undefined)
      },
    }),
    [flush, update],
  )

  return [chats, actions]
}
