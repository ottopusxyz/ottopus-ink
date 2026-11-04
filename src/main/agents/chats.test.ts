import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatus, ChatEvent } from '../../shared/ipc'
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

beforeEach(() => {
  session = fakeSession()
  vi.mocked(startClaudeSession).mockImplementation((options) => {
    launched = options
    return session
  })
})

afterEach(() => {
  vi.mocked(startClaudeSession).mockReset()
})

describe('startChat', () => {
  it('runs the binary detection found, with no servers but its own', () => {
    startChat(ready, env, () => undefined)
    expect(launched?.binary).toBe('/detected/claude')
    expect(launched?.mcpServers).toEqual({})
    expect(launched?.env?.PATH).toBe('/bin')
  })

  it.each(['signed-out', 'outdated', 'broken', 'missing'] as const)('refuses an agent that is %s', (state) => {
    expect(() => startChat({ ...ready, state }, env, () => undefined)).toThrow(/not ready/)
    expect(startClaudeSession).not.toHaveBeenCalled()
  })

  it('refuses an agent with no driver yet', () => {
    expect(() => startChat({ ...ready, id: 'codex' }, env, () => undefined)).toThrow(/isn't built yet/)
  })
})

describe('a running chat', () => {
  it('passes events on, marked with the chat they belong to', () => {
    const seen: [string, ChatEvent][] = []
    const chatId = startChat(ready, env, (id, event) => seen.push([id, event]))
    launched?.onEvent({ type: 'text', text: 'hi' })
    expect(seen).toEqual([[chatId, { type: 'text', text: 'hi' }]])
  })

  it('reaches only the chat it names', () => {
    const chatId = startChat(ready, env, () => undefined)
    sendToChat(chatId, 'hi')
    stopChatTurn(chatId)
    closeChat(chatId)
    expect(session.send).toHaveBeenCalledWith('hi')
    expect(session.stopTurn).toHaveBeenCalledOnce()
    expect(session.close).toHaveBeenCalledOnce()
    expect(() => sendToChat('another-id', 'hi')).toThrow(/ended/)
  })

  it('refuses a message past the limit without sending any of it', () => {
    const chatId = startChat(ready, env, () => undefined)
    expect(() => sendToChat(chatId, 'x'.repeat(200_001))).toThrow(/too long/)
    expect(session.send).not.toHaveBeenCalled()
  })

  it('forgets a chat once it has ended', () => {
    const chatId = startChat(ready, env, () => undefined)
    launched?.onEvent({ type: 'ended', error: null })
    expect(() => sendToChat(chatId, 'hi')).toThrow(/ended/)
  })

  it('kills what is still running when the app quits', () => {
    const chatId = startChat(ready, env, () => undefined)
    killChats()
    expect(session.kill).toHaveBeenCalledOnce()
    // The real session reports its end, which forgets it.
    launched?.onEvent({ type: 'ended', error: null })
    expect(() => stopChatTurn(chatId)).toThrow(/ended/)
  })
})
