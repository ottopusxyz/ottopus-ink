import { describe, expect, it } from 'vitest'
import type { ChatEvent, ChatPlan } from '../../../shared/ipc'
import { NOTHING_SIGNED } from '@/components/ui/copy'
import {
  chatContinued,
  restoredChat,
  applyChatEvent,
  chatFailedToStart,
  chatStarted,
  chatTurns,
  trimmedPlan,
  chatTitle,
  filterChats,
  HOME_DRAFT,
  ipcErrorText,
  isWorking,
  lockStatus,
  MAX_ITEMS,
  MAX_REPLY_CHARS,
  MAX_TOOL_CHARS,
  messageFailed,
  messageSent,
  newChat,
  planHeadline,
  toolLabel,
  waitingPlan,
  withDraft,
  type Chat,
} from './chats'

const started = () => chatStarted(newChat('c', 'claude-code', 'hello'), 'session')
const after = (events: ChatEvent[], chat: Chat = started()) => events.reduce((next, event) => applyChatEvent(next, event), chat)
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
    expect(chat.items.at(-1)).toMatchObject({ kind: 'notice', severity: 'block', text: `not built yet. ${NOTHING_SIGNED}`, ends: true })
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

  it('times a tool call from when it reached the page to its answer', () => {
    const call = applyChatEvent(started(), { type: 'tool-call', id: 't1', name: 'mcp__ottopus-ink__get_accounts', input: '{}' }, 1_000)
    const done = applyChatEvent(call, { type: 'tool-result', id: 't1', text: 'ok', isError: false }, 2_400)
    expect(done.items.at(-1)).toMatchObject({ kind: 'tool', startedAt: 1_000, result: { ms: 1_400 } })
    const untimed = applyChatEvent(applyChatEvent(started(), { type: 'tool-call', id: 't2', name: 'x', input: '' }), { type: 'tool-result', id: 't2', text: '', isError: false })
    expect(untimed.items.at(-1)).toMatchObject({ result: { ms: null } })
  })

  it('shows a tool call with no input', () => {
    expect(after([{ type: 'tool-call', id: 't', name: 'x', input: '' }]).items.at(-1)).toMatchObject({ input: '' })
  })

  it('moves a plan’s card along as main reports its status, and leaves other plans alone', () => {
    const other = { ...plan, id: 'other-plan' }
    const chat = after([{ type: 'plan', plan: other }, { type: 'plan', plan }, { type: 'plan-status', id: plan.id, status: 'confirmed' }])
    expect(chat.plan).toEqual({ ...plan, status: 'confirmed' })
    const cards = chat.items.flatMap((item) => (item.kind === 'plan' ? [item.plan] : []))
    expect(cards).toEqual([other, { ...plan, status: 'confirmed' }])
  })

  it('shows where a plan’s swap stands as main follows it', () => {
    const swap = { stage: 'done' as const, got: '17.4 USDC', refunded: null, link: 'https://basescan.org/tx/0xabc' }
    const chat = after([{ type: 'plan', plan }, { type: 'plan-status', id: plan.id, status: 'confirmed' }, { type: 'plan-swap', id: plan.id, swap }])
    expect(chat.plan).toEqual({ ...plan, status: 'confirmed', swap })
    expect(after([{ type: 'plan', plan }, { type: 'plan-status', id: plan.id, status: 'confirmed', transactionId: 'Tx1' }]).plan).toEqual({ ...plan, status: 'confirmed', transactionId: 'Tx1' })
    expect(after([{ type: 'plan', plan }, { type: 'plan-swap', id: 'unknown', swap }]).plan).toBe(plan)
  })

  it('puts Ink’s note on how a plan ended in the conversation, and shows the agent answering it', () => {
    const note = { tone: 'ok' as const, title: 'Swap done', lines: ['2 NEAR → 7.07 USDC.'], links: [] }
    const ready = { ...after([{ type: 'plan', plan }, { type: 'turn-end', outcome: 'done', error: null }]) }
    const noted = applyChatEvent(ready, { type: 'plan-note', id: plan.id, note })
    expect(noted.items.at(-1)).toMatchObject({ kind: 'ink-note', planId: plan.id, note })
    expect(noted.phase).toBe('ready')
    expect(applyChatEvent(noted, { type: 'ink-told' }).phase).toBe('answering')
  })

  it('ignores a status for a plan it has no card for', () => {
    const chat = after([{ type: 'plan', plan }, { type: 'plan-status', id: 'unknown', status: 'confirmed' }])
    expect(chat.plan).toBe(plan)
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
    // Not "nothing was signed": a chat can end after a plan it proposed was signed.
    expect(after([{ type: 'ended', error: 'exited with code 1' }]).items.at(-1)).toMatchObject({ kind: 'notice', text: 'exited with code 1', ends: true })
    expect(after([{ type: 'ended', error: null }]).items).toHaveLength(1)
  })

  it('marks a chat locked', () => {
    expect(after([{ type: 'lock', locked: true, found: [], external: [], needsSignIn: [], mayMoveFunds: [] }]).lock).toBe('locked')
  })

  it('says what broke the lock once, however the chat then ends', () => {
    const chat = after([
      { type: 'lock', locked: false, found: ['the tool Bash'], external: [], needsSignIn: [], mayMoveFunds: [] },
      { type: 'ended', error: 'Ink stopped this chat because the agent showed the tool Bash.' },
    ])
    expect(chat).toMatchObject({ lock: 'unlocked', phase: 'ended' })
    expect(chat.items.filter((item) => item.kind === 'notice')).toHaveLength(1)
    expect(chat.items.at(-1)).toMatchObject({ title: 'Ink stopped this chat', text: expect.stringContaining('the tool Bash') as string })
  })

  it('never goes from unlocked back to locked', () => {
    expect(after([{ type: 'lock', locked: false, found: ['x'], external: [], needsSignIn: [], mayMoveFunds: [] }, { type: 'lock', locked: true, found: [], external: [], needsSignIn: [], mayMoveFunds: [] }]).lock).toBe('unlocked')
  })

  it('removes the plan of an agent that broke the lock, and says so', () => {
    const chat = after([
      { type: 'plan', plan },
      { type: 'lock', locked: false, found: ['the tool Bash'], external: [], needsSignIn: [], mayMoveFunds: [] },
    ])
    expect(chat.plan).toBeNull()
    expect(chat.items.some((item) => item.kind === 'plan')).toBe(false)
    expect(chat.items.at(-1)).toMatchObject({ text: expect.stringContaining('Its plan was removed.') as string })
  })

  it('still says the lock broke if that arrives just after End', () => {
    const ended: Chat = { ...started(), phase: 'ended' }
    const chat = after([{ type: 'lock', locked: false, found: ['the tool Bash'], external: [], needsSignIn: [], mayMoveFunds: [] }], ended)
    expect(chat).toMatchObject({ lock: 'unlocked', phase: 'ended' })
    expect(chat.items.at(-1)).toMatchObject({ title: 'Ink stopped this chat' })
    expect(lockStatus(chat).text).toBe('Not locked, chat stopped')
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
    expect(chat.items.at(-1)).toMatchObject({ kind: 'notice', text: `That message is too long. ${NOTHING_SIGNED}` })
    expect(chat.items.at(-1)).not.toHaveProperty('ends')
    expect(messageFailed(started(), 'Too long.').items.at(-1)).toMatchObject({ text: `Too long. ${NOTHING_SIGNED}` })
  })

  it('adds nothing if the chat has already ended', () => {
    const ended = after([{ type: 'ended', error: 'gone' }])
    expect(messageFailed(ended, 'This chat has ended')).toBe(ended)
  })
})

describe('isWorking', () => {
  it('is true from starting until the turn is over', () => {
    expect((['starting', 'answering', 'stopping'] as const).every((phase) => isWorking({ phase }))).toBe(true)
    expect((['ready', 'ended'] as const).some((phase) => isWorking({ phase }))).toBe(false)
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

describe('a chat with external tools on', () => {
  const lock = (external: string[], mayMoveFunds: string[] = []): ChatEvent => ({ type: 'lock', locked: true, found: [], external, needsSignIn: [], mayMoveFunds })

  it('says plainly it is not only Ottopus tools', () => {
    const chat = after([lock(['near-tools', 'other'])])
    expect(chat.external).toEqual(['near-tools', 'other'])
    expect(lockStatus(chat)).toMatchObject({ text: 'Ottopus + 2 external tools', tone: 'plan' })
    expect(lockStatus(chat).hint).toContain('near-tools, other')
    expect(lockStatus(after([lock(['one'])])).text).toBe('Ottopus + 1 external tool')
  })

  it('keeps a tool waiting for sign-in out of the count, and notes it apart', () => {
    const chat = after([{ type: 'lock', locked: true, found: [], external: ['works'], needsSignIn: ['waiting'], mayMoveFunds: [] }])
    expect(chat.needsSignIn).toEqual(['waiting'])
    expect(lockStatus(chat).text).toBe('Ottopus + 1 external tool')
    expect(lockStatus(chat).hint).not.toContain('waiting')
  })

  it('says only Ottopus tools when all that was on is waiting for sign-in', () => {
    const chat = after([{ type: 'lock', locked: true, found: [], external: [], needsSignIn: ['waiting'], mayMoveFunds: [] }])
    expect(lockStatus(chat).text).toBe('Locked to Ottopus tools')
  })

  it('drops the note once a later report has the tool working', () => {
    const chat = after([
      { type: 'lock', locked: true, found: [], external: [], needsSignIn: ['waiting'], mayMoveFunds: [] },
      { type: 'lock', locked: true, found: [], external: ['waiting'], needsSignIn: [], mayMoveFunds: [] },
    ])
    expect(chat.needsSignIn).toEqual([])
  })

  it('still says locked when nothing external is on', () => {
    expect(lockStatus(after([lock([])])).text).toBe('Locked to Ottopus tools')
  })

  it('points out a tool that may move funds once, however many turns it appears on', () => {
    const chat = after([lock(['w'], ['mcp__w__send']), lock(['w'], ['mcp__w__send'])])
    const notices = chat.items.filter((item) => item.kind === 'notice')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ title: expect.stringContaining('move funds') as string, text: expect.stringContaining('mcp__w__send') as string })
  })

  it('says what could not be loaded', () => {
    expect(after([{ type: 'external-skipped', names: ['broken'] }]).items.at(-1)).toMatchObject({ kind: 'notice', text: expect.stringContaining('broken') as string })
  })

  it('stopping still wins over anything external', () => {
    const chat = after([lock(['w']), { type: 'lock', locked: false, found: ['the tool Bash'], external: ['w'], needsSignIn: [], mayMoveFunds: [] }])
    expect(lockStatus(chat).text).toBe('Not locked, chat stopped')
  })
})

describe('toolLabel', () => {
  it("shortens Ink's own tools and leaves anything else in full", () => {
    expect(toolLabel('mcp__ottopus-ink__get_accounts')).toBe('get_accounts')
    expect(toolLabel('Bash')).toBe('Bash')
    expect(toolLabel('mcp__ottopus-ink-evil__x')).toBe('mcp__ottopus-ink-evil__x')
    expect(toolLabel('mcp__ottopus-ink__sign_transaction')).toBe('mcp__ottopus-ink__sign_transaction')
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

describe('the plan waiting on Home', () => {
  const withPlan = (id: string, status: ChatPlan['status'] | null): Chat => ({
    ...chatStarted(newChat(id, 'claude-code', 'hello'), 'session'),
    plan: status ? { ...plan, id: `p-${id}`, status } : null,
  })

  it('is the first chat whose plan awaits review', () => {
    const chats = [withPlan('a', null), withPlan('b', 'draft'), withPlan('c', 'awaiting_review'), withPlan('d', 'awaiting_review')]
    expect(waitingPlan(chats)).toEqual({ chatId: 'c', plan: { ...plan, id: 'p-c', status: 'awaiting_review' } })
  })

  it('is nothing when no plan waits on the person', () => {
    expect(waitingPlan([withPlan('a', 'confirmed'), withPlan('b', 'signing')])).toBeNull()
    expect(waitingPlan([])).toBeNull()
  })
})

describe('a chat as turns', () => {
  it('keeps your messages alone and groups what the agent did after each', () => {
    const chat = after([
      { type: 'text', text: 'On it.' },
      { type: 'tool-call', id: 't1', name: 'mcp__ottopus-ink__get_portfolio', input: '{}' },
      { type: 'plan', plan },
    ])
    const turns = chatTurns([...chat.items, { kind: 'user', id: 'u2', text: 'thanks' }, { kind: 'agent', id: 'a2', text: 'Done.' }])
    expect(turns.map((turn) => (turn.kind === 'you' ? 'you' : turn.items.map((item) => item.kind).join('+')))).toEqual([
      'you',
      'agent+tool+plan',
      'you',
      'agent',
    ])
  })

  it('starts with the agent when the chat does', () => {
    expect(chatTurns([{ kind: 'notice', id: 'n', severity: 'info', title: 'Stopped', text: null }])).toEqual([
      { kind: 'agent', id: 'n', items: [{ kind: 'notice', id: 'n', severity: 'info', title: 'Stopped', text: null }] },
    ])
    expect(chatTurns([])).toEqual([])
  })
})

describe('a plan trimmed out of a long chat', () => {
  it('is shown on its own once its message is gone', () => {
    const chat = after([{ type: 'plan', plan }])
    expect(trimmedPlan(chat)).toBeNull()
    expect(trimmedPlan({ ...chat, items: chat.items.filter((item) => item.kind !== 'plan') })).toEqual(plan)
  })

  it('is nothing for a chat without a plan', () => {
    expect(trimmedPlan(started())).toBeNull()
  })

  it('follows the latest plan, not an older one still in the chat', () => {
    const chat = after([{ type: 'plan', plan }])
    expect(trimmedPlan({ ...chat, plan: { ...plan, id: 'newer' } })).toEqual({ ...plan, id: 'newer' })
  })
})

describe('a chat kept from before a restart', () => {
  const PLAN: ChatPlan = { id: 'p', status: 'awaiting_review', outcome: 'swap', asset: 'NEAR', amount: '2', chain: 'near', to: null, toAsset: 'USDC', toChain: 'base' }
  const saved = {
    id: '11111111-2222-4333-8444-555555555555',
    agent: 'claude-code' as const,
    opening: 'Swap 2 NEAR to USDC on Base',
    startedAt: 1,
    updatedAt: 2,
    events: [
      { type: 'you' as const, text: 'Swap 2 NEAR to USDC on Base' },
      { type: 'text' as const, text: 'Here is a plan.' },
      { type: 'plan' as const, plan: PLAN },
      { type: 'plan-status' as const, id: 'p', status: 'confirmed' as const, transactionId: 'Tx1' },
      { type: 'plan-note' as const, id: 'p', note: { tone: 'ok' as const, title: 'Swap done', lines: ['2 NEAR → 7.07 USDC.'], links: [] } },
      { type: 'continued' as const, agent: 'claude-code' as const, at: 3 },
      { type: 'you' as const, text: 'thanks' },
    ],
  }

  it('is drawn as it was, from Ink’s record, and is read-only', () => {
    const chat = restoredChat(saved)
    expect(chat).toMatchObject({ id: saved.id, title: 'Swap 2 NEAR to USDC on Base', agent: 'claude-code', phase: 'ended', restored: true, sessionId: null })
    expect(chat.items.map((item) => item.kind)).toEqual(['user', 'agent', 'plan', 'ink-note', 'notice', 'user'])
    expect(chat.plan).toMatchObject({ id: 'p', status: 'confirmed', transactionId: 'Tx1' })
  })

  it('goes on in a new session, which says what happened and that addresses need typing again', () => {
    const chat = chatContinued(restoredChat(saved), 'session-2', 'claude-code')
    expect(chat).toMatchObject({ sessionId: 'session-2', phase: 'answering', restored: false, lock: 'unchecked' })
    expect(chat.items.at(-1)).toMatchObject({ kind: 'notice', title: 'Continued after a restart' })
    expect(applyChatEvent(chat, { type: 'turn-end', outcome: 'done', error: null }).phase).toBe('ready')
  })
})
