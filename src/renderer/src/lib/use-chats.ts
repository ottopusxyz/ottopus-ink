import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentId, ChatEvent } from '../../../shared/ipc'
import { applyChatEvent, chatFailedToStart, chatStarted, ipcErrorText, messageFailed, messageSent, newChat, type Chat } from './chats'

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
}

/**
 * The chats in this window and their sessions in the main process. They live in
 * memory: a session keeps no history of its own, so a chat can't outlive it anyway.
 */
export function useChats(): [Chat[], ChatActions] {
  const [chats, setChats] = useState<Chat[]>([])
  const chatIds = useRef(new Map<string, string>())
  const queue = useRef<[string, ChatEvent][]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const update = useCallback((id: string, change: (chat: Chat) => Chat) => {
    setChats((all) => all.map((chat) => (chat.id === id ? change(chat) : chat)))
  }, [])

  const flush = useCallback(() => {
    timer.current = null
    const ready = new Map<string, ChatEvent[]>()
    const waiting: [string, ChatEvent][] = []
    for (const entry of queue.current) {
      const [sessionId, event] = entry
      const id = chatIds.current.get(sessionId)
      if (!id) {
        waiting.push(entry)
        continue
      }
      const events = ready.get(id)
      if (events) events.push(event)
      else ready.set(id, [event])
    }
    queue.current = waiting.slice(-MAX_WAITING_EVENTS)
    if (ready.size === 0) return
    setChats((all) =>
      all.map((chat) => ready.get(chat.id)?.reduce((next, event) => applyChatEvent(next, event), chat) ?? chat),
    )
  }, [])

  useEffect(() => {
    const unsubscribe = window.ink.onChatEvent((sessionId, event) => {
      queue.current.push([sessionId, event])
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
        window.ink.startChat(agent).then(
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
    }),
    [flush, update],
  )

  return [chats, actions]
}
