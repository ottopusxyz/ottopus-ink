import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SecretBox } from '../external/sign-ins'
import { createChatHistory, HISTORY_EVENTS, HISTORY_KEEP, savedEventOf } from './chat-history'

/** Stands in for the OS keyring: reversible, and not plain JSON on disk. */
const box: SecretBox = { canKeep: () => true, seal: (text) => Buffer.from(text).reverse(), open: (data) => Buffer.from(data).reverse().toString() }
const noKeyring: SecretBox = { canKeep: () => false, seal: () => Buffer.alloc(0), open: () => '' }
const ID = '11111111-2222-4333-8444-555555555555'
const idOf = (n: number) => `11111111-2222-4333-8444-${String(n).padStart(12, '0')}`
const PLAN = { id: 'p', status: 'awaiting_review' as const, outcome: 'swap' as const, asset: 'NEAR', amount: '2', chain: 'near', to: null, toAsset: 'USDC', toChain: 'base' }

const dirs: string[] = []
const fileIn = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ink-chats-'))
  dirs.push(dir)
  return join(dir, 'chats.bin')
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A history whose writes run when the test says. */
function history(file = fileIn(), seal = box) {
  const writes: (() => void)[] = []
  let time = 1_000
  const kept = createChatHistory({ file, box: seal, now: () => time, schedule: (write) => writes.push(write) })
  return { kept, file, write: () => writes.splice(0).forEach((write) => write()), tick: () => (time += 1) }
}

describe('the chat history', () => {
  it('keeps a chat sealed across restarts: what was said, joined replies, and what became of its plans', () => {
    const { kept, file, write } = history()
    kept.begin(ID, 'claude-code', 'Swap 2 NEAR to USDC on Base')
    kept.record(ID, { type: 'you', text: 'Swap 2 NEAR to USDC on Base' })
    kept.record(ID, { type: 'text', text: 'Sure, ' })
    kept.record(ID, { type: 'text', text: 'here is the plan.' })
    kept.record(ID, { type: 'plan', plan: PLAN })
    kept.record(ID, { type: 'plan-status', id: 'p', status: 'confirmed', transactionId: 'Tx1' })
    write()
    expect(readFileSync(file).toString()).not.toContain('Swap 2 NEAR')
    const reopened = history(file).kept
    expect(reopened.get(ID)).toMatchObject({
      agent: 'claude-code',
      opening: 'Swap 2 NEAR to USDC on Base',
      events: [
        { type: 'you', text: 'Swap 2 NEAR to USDC on Base' },
        { type: 'text', text: 'Sure, here is the plan.' },
        { type: 'plan', plan: PLAN },
        { type: 'plan-status', id: 'p', status: 'confirmed', transactionId: 'Tx1' },
      ],
    })
  })

  it('waits to write while a reply streams in, and writes at once when told to', () => {
    const { kept, file, write } = history()
    kept.begin(ID, 'claude-code', 'hi')
    for (let i = 0; i < 50; i++) kept.record(ID, { type: 'text', text: 'x' })
    expect(existsSync(file)).toBe(false)
    kept.flush()
    expect(existsSync(file)).toBe(true)
    write()
    expect(history(file).kept.get(ID)?.events).toEqual([{ type: 'text', text: 'x'.repeat(50) }])
  })

  it('picks a kept chat up again with the agent it continues with, newest first', () => {
    const { kept, tick } = history()
    kept.begin(ID, 'claude-code', 'first')
    tick()
    kept.begin(idOf(2), 'claude-code', 'second')
    tick()
    kept.begin(ID, 'codex', 'ignored')
    expect(kept.list().map((chat) => [chat.id, chat.agent, chat.opening])).toEqual([
      [ID, 'codex', 'first'],
      [idOf(2), 'claude-code', 'second'],
    ])
  })

  it('keeps the newest chats and each one’s latest events, and trims what tools returned', () => {
    const { kept } = history()
    for (let i = 0; i < HISTORY_KEEP + 3; i++) kept.begin(idOf(i), 'claude-code', `chat ${i}`)
    expect(kept.list()).toHaveLength(HISTORY_KEEP)
    kept.begin(ID, 'claude-code', 'long')
    for (let i = 0; i < HISTORY_EVENTS + 5; i++) kept.record(ID, { type: 'you', text: String(i) })
    expect(kept.get(ID)?.events).toHaveLength(HISTORY_EVENTS)
    expect(kept.get(ID)?.events[0]).toEqual({ type: 'you', text: '5' })
    expect(savedEventOf({ type: 'tool-result', id: 't', text: 'y'.repeat(5_000), isError: false })).toMatchObject({ text: `${'y'.repeat(2_000)}…` })
    expect(savedEventOf({ type: 'session', tools: null, servers: null, plugins: null, needsSignIn: [], model: null })).toBeNull()
    expect(savedEventOf({ type: 'turn-end', outcome: 'done', error: null })).toBeNull()
  })

  it('drops anything not in its own shape, and chats with ids it didn’t make', () => {
    const { file } = history()
    const good = { id: ID, agent: 'claude-code', opening: 'hi', startedAt: 1, updatedAt: 1, events: [{ type: 'you', text: 'hi' }, { type: 'lock', locked: true }, { type: 'plan-swap', id: 'p', swap: { stage: 'done', got: null, refunded: null, link: 'javascript:x' } }, { type: 'plan', plan: { id: 'p' } }] }
    writeFileSync(file, box.seal(JSON.stringify([good, { ...good, id: 'not-a-chat-id' }, { ...good, id: idOf(3), agent: 'mallory' }])))
    expect(history(file).kept.list().map((chat) => [chat.id, chat.events])).toEqual([[ID, [{ type: 'you', text: 'hi' }]]])
  })

  it('forgets one chat or all of them', () => {
    const { kept, file, write } = history()
    kept.begin(ID, 'claude-code', 'one')
    kept.begin(idOf(2), 'claude-code', 'two')
    write()
    kept.remove(ID)
    expect(history(file).kept.list().map((chat) => chat.id)).toEqual([idOf(2)])
    kept.clear()
    expect(existsSync(file)).toBe(false)
    expect(kept.list()).toEqual([])
  })

  it('keeps nothing on disk without a keyring', () => {
    const { kept, file } = history(fileIn(), noKeyring)
    kept.begin(ID, 'claude-code', 'hi')
    kept.flush()
    expect(kept.list()).toHaveLength(1)
    expect(existsSync(file)).toBe(false)
  })
})
