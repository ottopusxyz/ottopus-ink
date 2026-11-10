import { randomUUID } from 'node:crypto'
import type { AgentStatus, ChatEvent } from '../../shared/ipc'
import type { PlanStatus } from '../../shared/plan'
import { looksLikeItMovesFunds } from '../external/catalog'
import { itemsNeedingSignIn, type SessionExternal } from '../external/session'
import type { McpBridge } from '../mcp/bridge'
import { MCP_SERVER_NAME } from '../mcp/protocol'
import { claudeMcpServers, MCP_TOKEN_ENV } from './claude-launch'
import { startClaudeSession, type ChatSession } from './claude-session'
import { lockWatcher } from './lockdown'
import type { AgentEnv } from './login-env'

/** What a chat needs to reach Ink's tools. */
export interface ChatTools {
  bridge: Pick<McpBridge, 'socketPath' | 'addSession'>
  shim: string
  /**
   * Puts a plan the chat made up for review. `notify` hears each status it
   * reaches there. Main passes this in, so nothing here reaches the review
   * window or anything that signs.
   */
  review?: (planId: string, owner: string, notify: (status: PlanStatus) => void) => void
}

/** Longer than anyone types or pastes into a chat. */
const MAX_MESSAGE_CHARS = 200_000

/** Each chat is a whole agent process, so a page in a loop mustn't be able to start them without end. */
const MAX_OPEN_CHATS = 4

const chats = new Map<string, ChatSession>()

/**
 * The messages sent from each chat's box, newest last, as the page sent them. A
 * plan may pay an address only if it's the person's own or appears here, so this
 * is the one place the agent's own words can never reach.
 *
 * It keeps the agent out, not the page: main can't tell whether a person typed a
 * message or compromised page code sent it. So this stops a prompt injection
 * choosing the recipient, but proving a person chose it is left to the review
 * window, outside the page, where they confirm the recipient before signing.
 */
const typedIn = new Map<string, string[]>()
/** Enough of a conversation for the addresses someone gave; older messages make way. */
const TYPED_KEPT = 50

/**
 * Starts a chat with an agent detection found ready. Which binary runs comes
 * from detection, never from the renderer. Returns the chat's id; onEvent gets
 * everything that happens in it until an `ended` event.
 */
export function startChat(
  agent: AgentStatus,
  agentEnv: AgentEnv,
  { bridge, shim, review }: ChatTools,
  external: SessionExternal,
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
  const typed: string[] = []
  typedIn.set(chatId, typed)
  const tools = bridge.addSession({
    onPlan: (plan, owner) => {
      if (over || !locked) return
      onEvent(chatId, { type: 'plan', plan })
      review?.(plan.id, owner, (status) => {
        if (!over) onEvent(chatId, { type: 'plan-status', id: plan.id, status })
      })
    },
    typed: () => typed,
  })
  const watchLock = lockWatcher(tools.connected, external.serverNames)
  let externalTools: string[] = []
  let waiting = external.needsSignIn.map((item) => item.name)
  const session = startClaudeSession({
    binary: agent.path,
    env: { ...process.env, ...agentEnv },
    mcpServers: { ...claudeMcpServers({ shim, socketPath: bridge.socketPath }), ...external.servers },
    externalServers: external.serverNames,
    skillsText: external.skillsText,
    sessionEnv: { [MCP_TOKEN_ENV]: tools.token },
    onEvent: (event) => {
      // Stopping a session mid-line leaves the rest of that line still to arrive.
      if (over) return
      if (event.type === 'ended') {
        over = true
        chats.delete(chatId)
        typedIn.delete(chatId)
        tools.remove()
      }
      onEvent(chatId, event)
      if (event.type === 'session') {
        externalTools = (event.tools ?? []).filter((tool) => !tool.startsWith(`mcp__${MCP_SERVER_NAME}__`))
        waiting = [...new Set([...external.needsSignIn, ...itemsNeedingSignIn(external, event.needsSignIn)].map((item) => item.name))]
      }
      const found = watchLock(event)
      if (found === null) return
      locked = found.length === 0
      const mayMoveFunds = externalTools.filter((tool) => looksLikeItMovesFunds(tool.split('__').at(-1) ?? tool))
      const working = external.labels.filter((label) => !waiting.includes(label))
      onEvent(chatId, { type: 'lock', locked, found, external: working, needsSignIn: waiting, mayMoveFunds })
      if (found.length > 0) session.kill(`Ink stopped this chat because the agent showed ${found.join(', ')}.`)
    },
  })
  chats.set(chatId, session)
  if (external.skipped.length > 0) onEvent(chatId, { type: 'external-skipped', names: external.skipped })
  return chatId
}

export function sendToChat(chatId: string, text: string): void {
  if (text.length > MAX_MESSAGE_CHARS) throw new Error('That message is too long')
  const chat = chatById(chatId)
  const typed = typedIn.get(chatId)
  if (typed) {
    typed.push(text)
    if (typed.length > TYPED_KEPT) typed.splice(0, typed.length - TYPED_KEPT)
  }
  chat.send(text)
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
