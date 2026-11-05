import { randomUUID } from 'node:crypto'
import type { AgentStatus, ChatEvent } from '../../shared/ipc'
import type { McpBridge } from '../mcp/bridge'
import { claudeMcpServers, MCP_TOKEN_ENV } from './claude-launch'
import { startClaudeSession, type ChatSession } from './claude-session'
import { lockWatcher } from './lockdown'
import type { AgentEnv } from './login-env'

/** What a chat needs to reach Ink's tools. */
export interface ChatTools {
  bridge: Pick<McpBridge, 'socketPath' | 'addSession'>
  shim: string
}

/** Longer than anyone types or pastes into a chat. */
const MAX_MESSAGE_CHARS = 200_000

/** Each chat is a whole agent process, so a page in a loop mustn't be able to start them without end. */
const MAX_OPEN_CHATS = 4

const chats = new Map<string, ChatSession>()

/**
 * Starts a chat with an agent detection found ready. Which binary runs comes
 * from detection, never from the renderer. Returns the chat's id; onEvent gets
 * everything that happens in it until an `ended` event.
 */
export function startChat(
  agent: AgentStatus,
  agentEnv: AgentEnv,
  { bridge, shim }: ChatTools,
  onEvent: (chatId: string, event: ChatEvent) => void,
): string {
  if (agent.state !== 'ready' || !agent.path) throw new Error(`${agent.id} is not ready`)
  if (agent.id !== 'claude-code') throw new Error(`Chat with ${agent.id} isn't built yet`)
  if (chats.size >= MAX_OPEN_CHATS) throw new Error('Too many chats are open. End one first.')

  const chatId = randomUUID()
  // One token for each chat, gone with it.
  let over = false
  // Nothing an unchecked session proposes reaches the person.
  let locked = false
  const tools = bridge.addSession({
    onPlan: (plan) => {
      if (!over && locked) onEvent(chatId, { type: 'plan', plan })
    },
  })
  const watchLock = lockWatcher(tools.connected)
  const session = startClaudeSession({
    binary: agent.path,
    env: { ...process.env, ...agentEnv },
    mcpServers: claudeMcpServers({ shim, socketPath: bridge.socketPath }),
    sessionEnv: { [MCP_TOKEN_ENV]: tools.token },
    onEvent: (event) => {
      // Stopping a session mid-line leaves the rest of that line still to arrive.
      if (over) return
      if (event.type === 'ended') {
        over = true
        chats.delete(chatId)
        tools.remove()
      }
      onEvent(chatId, event)
      const found = watchLock(event)
      if (found === null) return
      locked = found.length === 0
      onEvent(chatId, { type: 'lock', locked, found })
      if (found.length > 0) session.kill(`Ink stopped this chat because the agent showed ${found.join(', ')}.`)
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
