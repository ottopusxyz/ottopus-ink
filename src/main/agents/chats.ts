import { randomUUID } from 'node:crypto'
import type { AgentStatus, ChatDeposit, ChatEvent, ChatSwap, DepositProgress, InkNote, PlanJourney, ReceiveAnswer } from '../../shared/ipc'
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
  review?: (planId: string, owner: string, notify: (status: PlanStatus, transactionId: string | null) => void) => void
  /**
   * Tells the chat where a plan stands after review: a swap's progress once its deposit
   * landed, and how the plan ended, with Ink's note and the same facts for the agent.
   * Main passes this in too.
   */
  follow?: (planId: string, owner: string, listen: { swap: (swap: ChatSwap) => void; journey: (journey: PlanJourney) => void; ending: (ending: PlanEnding) => void }) => void
  /**
   * Shows and watches an address get_deposit_address gave the chat's agent. Each of
   * `listen` says whether the chat was still open to hear it. Main passes this in.
   */
  deposits?: (chatId: string, owner: string, ask: { chain: string; asset: string; amount: string | null }, answer: Extract<ReceiveAnswer, { ok: true }>, listen: DepositListen) => void
}

/** What a chat hears of a deposit it showed. Each says whether the chat was still open. */
export interface DepositListen {
  show: (deposit: ChatDeposit) => boolean
  progress: (id: string, progress: DepositProgress) => boolean
  ending: (id: string, ending: PlanEnding) => boolean
}

/** How a plan ended: Ink's note for the person, and the facts to pass to the agent. */
export interface PlanEnding {
  note: InkNote
  forAgent: string
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

/** Whether a chat's agent is mid-turn, and what Ink waits to tell it once it isn't. */
interface Turn {
  busy: boolean
  forAgent: string[]
  /** Tells the page the agent is answering Ink. */
  told: () => void
}

const turns = new Map<string, Turn>()

/**
 * Starts a chat with an agent detection found ready. Which binary runs comes
 * from detection, never from the renderer. Returns the chat's id; onEvent gets
 * everything that happens in it until an `ended` event.
 */
export function startChat(
  agent: AgentStatus,
  agentEnv: AgentEnv,
  { bridge, shim, review, follow, deposits }: ChatTools,
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
  // Free until the first message, from the person or from Ink, starts a turn.
  const turn: Turn = { busy: false, forAgent: [], told: () => onEvent(chatId, { type: 'ink-told' }) }
  turns.set(chatId, turn)
  const tools = bridge.addSession({
    onPlan: (plan, owner) => {
      if (over || !locked) return
      onEvent(chatId, { type: 'plan', plan })
      review?.(plan.id, owner, (status, transactionId) => {
        if (!over) onEvent(chatId, { type: 'plan-status', id: plan.id, status, ...(transactionId ? { transactionId } : {}) })
      })
      follow?.(plan.id, owner, {
        swap: (swap) => {
          if (!over) onEvent(chatId, { type: 'plan-swap', id: plan.id, swap })
        },
        journey: (journey) => {
          if (!over) onEvent(chatId, { type: 'plan-journey', id: plan.id, journey })
        },
        ending: ({ note, forAgent }) => {
          if (over) return
          onEvent(chatId, { type: 'plan-note', id: plan.id, note })
          turn.forAgent.push(forAgent)
          if (!turn.busy) tellAgent(chatId)
        },
      })
    },
    onReceive: (ask, answer, owner) => {
      if (over || !locked) return
      deposits?.(chatId, owner, ask, answer, {
        show: (deposit) => (over ? false : (onEvent(chatId, { type: 'deposit', deposit }), true)),
        progress: (id, progress) => (over ? false : (onEvent(chatId, { type: 'deposit-progress', id, progress }), true)),
        ending: (id, { note, forAgent }) => {
          if (over) return false
          onEvent(chatId, { type: 'deposit-note', id, note })
          turn.forAgent.push(forAgent)
          if (!turn.busy) tellAgent(chatId)
          return true
        },
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
        turns.delete(chatId)
        tools.remove()
      }
      onEvent(chatId, event)
      if (event.type === 'turn-end') {
        turn.busy = false
        tellAgent(chatId)
      }
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
  const turn = turns.get(chatId)
  if (turn) turn.busy = true
  chat.send(text)
}

/**
 * Tells the agent something from Ink rather than the person, such as the recap that
 * opens a chat continued after a restart: now if its turn is free, else once it is.
 * Like a plan's ending, it never counts as something the person typed.
 */
export function sendFromInk(chatId: string, text: string): void {
  if (text.length > MAX_MESSAGE_CHARS) throw new Error('That message is too long')
  const turn = turns.get(chatId)
  if (!turn || !chats.has(chatId)) throw new Error('This chat has ended')
  turn.forAgent.push(text)
  tellAgent(chatId)
}

/**
 * Passes what Ink has to tell the agent, once its turn is free, as one message. It never
 * joins the person's typed messages, so nothing in it counts as an address they typed.
 */
function tellAgent(chatId: string): void {
  const turn = turns.get(chatId)
  const chat = chats.get(chatId)
  if (!turn || !chat || turn.busy || turn.forAgent.length === 0) return
  const text = turn.forAgent.splice(0).join('\n\n')
  turn.busy = true
  chat.send(text)
  turn.told()
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
