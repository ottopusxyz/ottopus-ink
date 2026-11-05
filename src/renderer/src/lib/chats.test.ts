import { describe, expect, it } from 'vitest'
import type { ChatEvent, ChatPlan } from '../../../shared/ipc'
import {
  applyChatEvent,
  chatFailedToStart,
  chatStarted,
  chatTitle,
  filterChats,
  HOME_DRAFT,
  ipcErrorText,
  lockStatus,
  MAX_ITEMS,
  MAX_REPLY_CHARS,
  MAX_TOOL_CHARS,
  messageFailed,
  messageSent,
  newChat,
  planHeadline,
  toolLabel,
  withDraft,
  type Chat,
} from './chats'

const started = () => chatStarted(newChat('c', 'claude-code', 'hello'), 'session')
const after = (events: ChatEvent[], chat: Chat = started()) => events.reduce(applyChatEvent, chat)
const texts = (chat: Chat) => chat.items.map((item) => ('text' in item ? item.text : item.kind))
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

describe('a chat starting', () => {
  it('shows the first message and waits for the session', () => {
    const chat = newChat('c', 'claude-code', 'hello there')
    expect(chat).toMatchObject({ title: 'hello there', phase: 'starting', lock: 'unchecked', sessionId: null })
    expect(texts(chat)).toEqual(['hello there'])
  })

  it('answers once the session is up', () => {
    expect(started()).toMatchObject({ sessionId: 'session', phase: 'answering' })
  })

  it('ends with the reason when it cannot start', () => {
    const chat = chatFailedToStart(newChat('c', 'codex', 'hi'), 'not built yet')
    expect(chat.phase).toBe('ended')
    expect(chat.items.at(-1)).toMatchObject({ kind: 'notice', severity: 'block', text: 'not built yet' })
  })
})

describe('applyChatEvent', () => {
  it('joins pieces of a reply, and starts a new reply after anything else', () => {
    const chat = after([
      { type: 'text', text: 'one ' },
      { type: 'text', text: 'two' },
      { type: 'tool-call', id: 't', name: 'x', input: '{}' },
      { type: 'text', text: 'three' },
    ])
    expect(texts(chat)).toEqual(['hello', 'one two', 'tool', 'three'])
  })

  it('fills in a tool call when its result arrives, and ignores a result for nothing', () => {
    const chat = after([
      { type: 'tool-call', id: 't', name: 'mcp__ottopus-ink__get_accounts', input: '{}' },
      { type: 'tool-result', id: 'other', text: 'stray', isError: false },
    ])
    expect(chat.items.at(-1)).toMatchObject({ kind: 'tool', result: null })
    const done = after([{ type: 'tool-result', id: 't', text: 'not set up', isError: true }], chat)
    expect(done.items.at(-1)).toMatchObject({ kind: 'tool', result: { text: 'not set up', isError: true } })
    expect(done.items).toHaveLength(2)
  })

  it('shows a tool call with no input', () => {
    expect(after([{ type: 'tool-call', id: 't', name: 'x', input: '' }]).items.at(-1)).toMatchObject({ input: '' })
  })

  it('keeps the newest plan and puts it in the conversation', () => {
    const chat = after([{ type: 'plan', plan }])
    expect(chat.plan).toBe(plan)
    expect(chat.items.at(-1)).toMatchObject({ kind: 'plan', plan })
  })

  it('goes back to ready after a turn, with a note unless it went well', () => {
    expect(after([{ type: 'turn-end', outcome: 'done', error: null }])).toMatchObject({ phase: 'ready' })
    expect(after([{ type: 'turn-end', outcome: 'done', error: null }]).items).toHaveLength(1)

    const stopped = after([{ type: 'turn-end', outcome: 'stopped', error: null }])
    expect(stopped.phase).toBe('ready')
    expect(stopped.items.at(-1)).toMatchObject({ kind: 'notice', severity: 'info', title: 'Stopped' })

    const failed = after([{ type: 'turn-end', outcome: 'failed', error: 'Not logged in' }])
    expect(failed.phase).toBe('ready')
    expect(failed.items.at(-1)).toMatchObject({ kind: 'notice', severity: 'block', text: 'Not logged in' })
  })

  it('stays ended when a turn ends after the chat did', () => {
    const chat = after([
      { type: 'ended', error: null },
      { type: 'turn-end', outcome: 'done', error: null },
    ])
    expect(chat.phase).toBe('ended')
  })

  it('says why a chat ended, but not when Ink closed it', () => {
    expect(after([{ type: 'ended', error: 'exited with code 1' }]).items.at(-1)).toMatchObject({ kind: 'notice', text: 'exited with code 1' })
    expect(after([{ type: 'ended', error: null }]).items).toHaveLength(1)
  })

  it('marks a chat locked', () => {
    expect(after([{ type: 'lock', locked: true, found: [] }]).lock).toBe('locked')
  })

  it('says what broke the lock once, however the chat then ends', () => {
    const chat = after([
      { type: 'lock', locked: false, found: ['the tool Bash'] },
      { type: 'ended', error: 'Ink stopped this chat because the agent showed the tool Bash.' },
    ])
    expect(chat).toMatchObject({ lock: 'unlocked', phase: 'ended' })
    expect(chat.items.filter((item) => item.kind === 'notice')).toHaveLength(1)
    expect(chat.items.at(-1)).toMatchObject({ title: 'Ink stopped this chat', text: expect.stringContaining('the tool Bash') as string })
  })

  it('never goes from unlocked back to locked', () => {
    expect(after([{ type: 'lock', locked: false, found: ['x'] }, { type: 'lock', locked: true, found: [] }]).lock).toBe('unlocked')
  })

  it('removes the plan of an agent that broke the lock, and says so', () => {
    const chat = after([
      { type: 'plan', plan },
      { type: 'lock', locked: false, found: ['the tool Bash'] },
    ])
    expect(chat.plan).toBeNull()
    expect(chat.items.some((item) => item.kind === 'plan')).toBe(false)
    expect(chat.items.at(-1)).toMatchObject({ text: expect.stringContaining('Its plan was removed.') as string })
  })

  it('takes nothing more once a chat has ended, even while its process is closing', () => {
    const ended: Chat = { ...started(), phase: 'ended' }
    const events: ChatEvent[] = [{ type: 'text', text: 'late' }, { type: 'plan', plan }, { type: 'tool-call', id: 't', name: 'x', input: '{}' }]
    expect(after(events, ended)).toBe(ended)
  })
})

describe('limits on what an agent can fill', () => {
  it('drops the oldest items, says so, and keeps ids unique', () => {
    const chat = after(Array.from({ length: MAX_ITEMS + 5 }, (_, i): ChatEvent => ({ type: 'tool-call', id: `${i}`, name: 'x', input: '{}' })))
    expect(chat.items).toHaveLength(MAX_ITEMS)
    expect(chat.trimmed).toBe(true)
    expect(new Set(chat.items.map((item) => item.id)).size).toBe(MAX_ITEMS)
  })

  it('keeps the newest plan after its row is dropped', () => {
    const chat = after([{ type: 'plan', plan }, ...Array.from({ length: MAX_ITEMS }, (_, i): ChatEvent => ({ type: 'tool-call', id: `${i}`, name: 'x', input: '{}' }))])
    expect(chat.items.some((item) => item.kind === 'plan')).toBe(false)
    expect(chat.plan).toBe(plan)
  })

  it('cuts a reply, in one piece or many', () => {
    const big = 'x'.repeat(MAX_REPLY_CHARS)
    expect(after([{ type: 'text', text: `${big}x` }]).items.at(-1)).toMatchObject({ text: `${big}…` })
    const pieces = after([{ type: 'text', text: big }, { type: 'text', text: 'y' }, { type: 'text', text: 'z' }])
    expect(pieces.items.at(-1)).toMatchObject({ text: `${big}…` })
  })

  it('cuts a tool input and result', () => {
    const big = 'x'.repeat(MAX_TOOL_CHARS + 1)
    const chat = after([
      { type: 'tool-call', id: 't', name: 'x', input: big },
      { type: 'tool-result', id: 't', text: big, isError: false },
    ])
    const item = chat.items.at(-1)
    if (item?.kind !== 'tool') throw new Error('expected a tool')
    expect(item.input).toHaveLength(MAX_TOOL_CHARS + 1)
    expect(item.result?.text).toHaveLength(MAX_TOOL_CHARS + 1)
  })
})

describe('sending another message', () => {
  it('starts a turn', () => {
    const chat = messageSent(after([{ type: 'turn-end', outcome: 'done', error: null }]), 'again')
    expect(chat.phase).toBe('answering')
    expect(chat.items.at(-1)).toMatchObject({ kind: 'user', text: 'again' })
  })

  it('goes back to ready with the reason if it fails', () => {
    const chat = messageFailed(started(), 'That message is too long')
    expect(chat.phase).toBe('ready')
    expect(chat.items.at(-1)).toMatchObject({ kind: 'notice', text: 'That message is too long' })
  })

  it('adds nothing if the chat has already ended', () => {
    const ended = after([{ type: 'ended', error: 'gone' }])
    expect(messageFailed(ended, 'This chat has ended')).toBe(ended)
  })
})

describe('lockStatus', () => {
  it('only says locked once a report has shown it', () => {
    expect(lockStatus({ lock: 'unchecked', phase: 'answering' })).toMatchObject({ text: 'Lock not checked yet', tone: 'plan' })
    expect(lockStatus({ lock: 'locked', phase: 'ready' })).toMatchObject({ text: 'Locked to Ottopus tools', tone: 'ok' })
  })

  it('stops saying locked when nothing is running', () => {
    expect(lockStatus({ lock: 'locked', phase: 'ended' })).toMatchObject({ text: 'Chat ended', tone: 'neutral' })
    expect(lockStatus({ lock: 'unchecked', phase: 'ended' })).toMatchObject({ text: 'Chat ended', tone: 'neutral' })
  })

  it('keeps saying a chat was not locked after it ended', () => {
    expect(lockStatus({ lock: 'unlocked', phase: 'ended' })).toMatchObject({ text: 'Not locked, chat stopped', tone: 'block' })
  })
})

describe('toolLabel', () => {
  it("shortens Ink's own tools and leaves anything else in full", () => {
    expect(toolLabel('mcp__ottopus-ink__get_accounts')).toBe('get_accounts')
    expect(toolLabel('Bash')).toBe('Bash')
    expect(toolLabel('mcp__ottopus-ink-evil__x')).toBe('mcp__ottopus-ink-evil__x')
  })
})

describe('planHeadline', () => {
  it('reads as one short line', () => {
    expect(planHeadline(plan)).toBe('Send 1 NEAR')
    expect(planHeadline({ ...plan, outcome: 'swap', amount: '0.1', asset: 'ETH', toAsset: 'USDC' })).toBe('Swap 0.1 ETH to USDC')
    expect(planHeadline({ ...plan, outcome: 'stake', amount: '10' })).toBe('Stake 10 NEAR')
  })
})

describe('ipcErrorText', () => {
  it("takes off Electron's wrapping", () => {
    expect(ipcErrorText(new Error("Error invoking remote method 'chat:start': Error: Too many chats are open."))).toBe('Too many chats are open.')
  })

  it('leaves anything else as it is', () => {
    expect(ipcErrorText(new Error('plain'))).toBe('plain')
    expect(ipcErrorText('text')).toBe('text')
  })
})

describe('chatTitle', () => {
  it('uses the first non-empty line with whitespace collapsed', () => {
    expect(chatTitle('\n  Swap   0.1 ETH\tto USDC  \nthen stake')).toBe('Swap 0.1 ETH to USDC')
  })

  it('cuts long text at a word boundary', () => {
    const title = chatTitle('Move five USDC from Base over to NEAR and then stake all of it with my validator')
    expect(title).toBe('Move five USDC from Base over to NEAR and then…')
    expect(title.length).toBeLessThanOrEqual(48)
  })

  it('cuts mid-word when there is no late space', () => {
    expect(chatTitle('a'.repeat(60), 10)).toBe(`${'a'.repeat(9)}…`)
  })

  it('names an empty chat', () => {
    expect(chatTitle('   \n ')).toBe('New chat')
  })
})

describe('filterChats', () => {
  const chats = [{ title: 'Swap 0.1 ETH to USDC on Base' }, { title: 'Send 20 USDC to mom.near' }, { title: 'Stake NEAR' }]

  it('returns everything for an empty query', () => {
    expect(filterChats(chats, '  ')).toHaveLength(3)
  })

  it('matches every word in any order, ignoring case', () => {
    expect(filterChats(chats, 'usdc SEND').map((c) => c.title)).toEqual(['Send 20 USDC to mom.near'])
    expect(filterChats(chats, 'usdc')).toHaveLength(2)
    expect(filterChats(chats, 'bitcoin')).toHaveLength(0)
  })
})

describe('withDraft', () => {
  it('keeps a draft per key', () => {
    const drafts = withDraft(withDraft({}, HOME_DRAFT, 'Stake 10 NEAR'), 'chat-a', 'and then')
    expect(drafts).toEqual({ [HOME_DRAFT]: 'Stake 10 NEAR', 'chat-a': 'and then' })
  })

  it('removes a key when its text is cleared', () => {
    expect(withDraft({ 'chat-a': 'x', 'chat-b': 'y' }, 'chat-a', '')).toEqual({ 'chat-b': 'y' })
  })

  it('returns the same object when clearing a key that is not there', () => {
    const drafts = { 'chat-a': 'x' }
    expect(withDraft(drafts, 'chat-b', '')).toBe(drafts)
  })
})
