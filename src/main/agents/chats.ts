import { randomUUID } from 'node:crypto'
import type { AgentStatus, ChatEvent } from '../../shared/ipc'
import { startClaudeSession, type ChatSession } from './claude-session'
import type { AgentEnv } from './login-env'

/** Longer than anyone types or pastes into a chat. */
const MAX_MESSAGE_CHARS = 200_000

const chats = new Map<string, ChatSession>()

/**
 * Starts a chat with an agent detection found ready. Which binary runs comes
 * from detection, never from the renderer. Returns the chat's id; onEvent gets
 * everything that happens in it until an `ended` event.
 */
export function startChat(
  agent: AgentStatus,
  agentEnv: AgentEnv,
  onEvent: (chatId: string, event: ChatEvent) => void,
): string {
  if (agent.state !== 'ready' || !agent.path) throw new Error(`${agent.id} is not ready`)
  if (agent.id !== 'claude-code') throw new Error(`Chat with ${agent.id} isn't built yet`)

  const chatId = randomUUID()
  const session = startClaudeSession({
    binary: agent.path,
    env: { ...process.env, ...agentEnv },
    // No Ink tools yet: the MCP shim comes next, and goes here.
    mcpServers: {},
    onEvent: (event) => {
      if (event.type === 'ended') chats.delete(chatId)
      onEvent(chatId, event)
    },
  })
  chats.set(chatId, session)
  return chatId
}

export function sendToChat(chatId: string, text: string): void {
  if (text.length > MAX_MESSAGE_CHARS) throw new Error('That message is too long')
  chatById(chatId).send(text)
}

export function stopChatTurn(chatId: string): void {
  chatById(chatId).stopTurn()
}

export function closeChat(chatId: string): void {
  chatById(chatId).close()
}

/** Ends every chat now, for when the app quits. */
export function killChats(): void {
  for (const chat of [...chats.values()]) chat.kill()
}

function chatById(chatId: string): ChatSession {
  const chat = chats.get(chatId)
  if (!chat) throw new Error('This chat has ended')
  return chat
}
