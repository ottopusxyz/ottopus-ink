import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatus, ChatEvent, ChatPlan } from '../../shared/ipc'
import { closeChat, killChats, sendToChat, startChat, stopChatTurn } from './chats'
import { startClaudeSession, type ChatSession, type ClaudeSessionOptions } from './claude-session'

vi.mock('./claude-session', () => ({ startClaudeSession: vi.fn() }))

const ready: AgentStatus = {
  id: 'claude-code',
  state: 'ready',
  path: '/detected/claude',
  version: '2.1.318',
  missing: [],
  signedIn: true,
}
const env = { PATH: '/bin' }
const removeTools = vi.fn<() => void>()
const tools = {
  shim: '/app/shim.js',
  bridge: {
    socketPath: '/run/ink/mcp.sock',
    addSession: (handlers?: { onPlan?: (plan: ChatPlan) => void }) => {
      proposePlan = handlers?.onPlan
      return { token: 'token-for-this-chat', connected: () => shimConnected, remove: removeTools }
    },
  },
}
let proposePlan: ((plan: ChatPlan) => void) | undefined
let shimConnected = true
const inkTool = 'mcp__ottopus-ink__get_accounts'
const report = (extra: string[] = []): ChatEvent => ({
  type: 'session',
  tools: [inkTool, ...extra],
  servers: ['ottopus-ink'],
  plugins: [],
  model: null,
})

function fakeSession() {
  return {
    send: vi.fn<ChatSession['send']>(),
    stopTurn: vi.fn<ChatSession['stopTurn']>(),
    close: vi.fn<ChatSession['close']>(),
    kill: vi.fn<ChatSession['kill']>(),
  }
}

let session: ReturnType<typeof fakeSession>
let launched: ClaudeSessionOptions | undefined
const launches: ClaudeSessionOptions[] = []

beforeEach(() => {
  session = fakeSession()
  shimConnected = true
  vi.mocked(startClaudeSession).mockImplementation((options) => {
    launched = options
    launches.push(options)
    return session
  })
})

afterEach(() => {
  // The registry outlives each test, so every chat a test opened has to end.
  for (const options of launches.splice(0)) options.onEvent({ type: 'ended', error: null })
  vi.mocked(startClaudeSession).mockReset()
})

describe('startChat', () => {
  it('runs the binary detection found, with no servers but its own', () => {
    startChat(ready, env, tools, () => undefined)
    expect(launched?.binary).toBe('/detected/claude')
    expect(Object.keys(launched?.mcpServers ?? {})).toEqual(['ottopus-ink'])
    expect(launched?.env?.PATH).toBe('/bin')
  })

  it('hands the token to the process alone, never into its MCP config', () => {
    startChat(ready, env, tools, () => undefined)
    expect(launched?.sessionEnv).toEqual({ OTTOPUS_INK_TOKEN: 'token-for-this-chat' })
    expect(JSON.stringify(launched?.mcpServers)).not.toContain('token-for-this-chat')
  })

  it.each(['signed-out', 'outdated', 'broken', 'missing'] as const)('refuses an agent that is %s', (state) => {
    expect(() => startChat({ ...ready, state }, env, tools, () => undefined)).toThrow(/not ready/)
    expect(startClaudeSession).not.toHaveBeenCalled()
  })

  it('refuses an agent with no driver yet', () => {
    expect(() => startChat({ ...ready, id: 'codex' }, env, tools, () => undefined)).toThrow(/isn't built yet/)
  })

  it('refuses a fifth open chat without starting a process, and allows one again after a chat ends', () => {
    for (let i = 0; i < 4; i++) startChat(ready, env, tools, () => undefined)
    expect(() => startChat(ready, env, tools, () => undefined)).toThrow(/Too many chats/)
    expect(startClaudeSession).toHaveBeenCalledTimes(4)

    launched?.onEvent({ type: 'ended', error: null })
    startChat(ready, env, tools, () => undefined)
    expect(startClaudeSession).toHaveBeenCalledTimes(5)
  })
})

describe('the lock on a chat', () => {
  const eventsOf = () => {
    const seen: ChatEvent[] = []
    startChat(ready, env, tools, (_id, event) => seen.push(event))
    return seen
  }

  it('says a session with only Ink tools is locked, and leaves it running', () => {
    const seen = eventsOf()
    launched?.onEvent(report())
    expect(seen).toEqual([report(), { type: 'lock', locked: true, found: [] }])
    expect(session.kill).not.toHaveBeenCalled()
  })

  it('stops a session with an extra tool and says why', () => {
    const seen = eventsOf()
    launched?.onEvent(report(['Bash']))
    expect(seen.at(-1)).toEqual({ type: 'lock', locked: false, found: ['the tool Bash'] })
    expect(session.kill).toHaveBeenCalledExactlyOnceWith('Ink stopped this chat because the agent showed the tool Bash.')
  })

  it('stops a session whose Ink tools never came through the shim', () => {
    shimConnected = false
    eventsOf()
    launched?.onEvent(report())
    expect(session.kill).toHaveBeenCalledOnce()
  })

  it('passes on nothing after a chat has ended', () => {
    const seen = eventsOf()
    launched?.onEvent({ type: 'ended', error: 'gone' })
    launched?.onEvent({ type: 'text', text: 'late' })
    expect(seen).toEqual([{ type: 'ended', error: 'gone' }])
  })
})

describe('a running chat', () => {
  it('passes events on, marked with the chat they belong to', () => {
    const seen: [string, ChatEvent][] = []
    const chatId = startChat(ready, env, tools, (id, event) => seen.push([id, event]))
    launched?.onEvent({ type: 'text', text: 'hi' })
    expect(seen).toEqual([[chatId, { type: 'text', text: 'hi' }]])
  })

  it('passes on plans from the server until the chat ends', () => {
    const plan: ChatPlan = {
      id: 'p',
      status: 'draft',
      outcome: 'send',
      asset: 'NEAR',
      amount: '1',
      chain: null,
      to: null,
      toAsset: null,
      toChain: null,
    }
    const seen: ChatEvent[] = []
    startChat(ready, env, tools, (_id, event) => seen.push(event))
    proposePlan?.(plan)
    expect(seen).toEqual([{ type: 'plan', plan }])
    launched?.onEvent({ type: 'ended', error: null })
    proposePlan?.(plan)
    expect(seen).toHaveLength(2)
  })

  it('reaches only the chat it names', () => {
    const chatId = startChat(ready, env, tools, () => undefined)
    sendToChat(chatId, 'hi')
    stopChatTurn(chatId)
    closeChat(chatId)
    expect(session.send).toHaveBeenCalledWith('hi')
    expect(session.stopTurn).toHaveBeenCalledOnce()
    expect(session.close).toHaveBeenCalledOnce()
    expect(() => sendToChat('another-id', 'hi')).toThrow(/ended/)
  })

  it('refuses a message past the limit without sending any of it', () => {
    const chatId = startChat(ready, env, tools, () => undefined)
    expect(() => sendToChat(chatId, 'x'.repeat(200_001))).toThrow(/too long/)
    expect(session.send).not.toHaveBeenCalled()
  })

  it('forgets a chat once it has ended, and revokes its token', () => {
    removeTools.mockClear()
    const chatId = startChat(ready, env, tools, () => undefined)
    expect(removeTools).not.toHaveBeenCalled()
    launched?.onEvent({ type: 'ended', error: null })
    expect(removeTools).toHaveBeenCalledOnce()
    expect(() => sendToChat(chatId, 'hi')).toThrow(/ended/)
  })

  it('kills what is still running when the app quits', () => {
    const chatId = startChat(ready, env, tools, () => undefined)
    killChats()
    expect(session.kill).toHaveBeenCalledOnce()
    // The real session reports its end, which forgets it.
    launched?.onEvent({ type: 'ended', error: null })
    expect(() => stopChatTurn(chatId)).toThrow(/ended/)
  })
})
