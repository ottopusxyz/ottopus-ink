import { describe, expect, it, vi } from 'vitest'
import type { InkNote } from '../shared/ipc'
import { createNotifier, noticeOf } from './notify'

const PAID: InkNote = { tone: 'ok', title: 'Paid', lines: ['15 USDC reached 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM on Solana.', 'From 10 USDC on Base and 5 USDT in your NEAR Intents balance.'], links: [] }
const FAILED: InkNote = { tone: 'block', title: 'Not sent', lines: ['6 USDC: Solana turned it down.'], links: [] }

function notifier({ focused = false, unlocked = true, supported = true } = {}) {
  const show = vi.fn()
  const open = vi.fn()
  return { notify: createNotifier({ supported: () => supported, focused: () => focused, unlocked: () => unlocked, show, open }), show, open }
}

describe('notifications when something ends', () => {
  it('shows the note’s title and first line while Ink is away and unlocked, and clicking opens Ink', () => {
    const { notify, show, open } = notifier()
    notify(PAID)
    expect(show).toHaveBeenCalledWith({ title: 'Paid', body: PAID.lines[0] }, open)
  })

  it('says nothing about the money while Ink is locked, since the lock screen may show it', () => {
    expect(noticeOf(PAID, false)).toEqual({ title: 'Ottopus Ink', body: 'Something you started has finished. Unlock Ink to see it.' })
    expect(noticeOf(FAILED, false).body).toMatch(/didn’t go through/)
    expect(JSON.stringify(noticeOf(PAID, false))).not.toMatch(/USDC|9WzD/)
  })

  it('shows nothing while an Ink window has focus, or where the OS has no notifications', () => {
    for (const options of [{ focused: true }, { supported: false }]) {
      const { notify, show } = notifier(options)
      notify(PAID)
      expect(show).not.toHaveBeenCalled()
    }
  })

  it('cuts a long first line short', () => {
    const body = noticeOf({ ...PAID, lines: ['x'.repeat(400)] }, true).body
    expect(body).toHaveLength(160)
    expect(body.endsWith('…')).toBe(true)
  })
})
