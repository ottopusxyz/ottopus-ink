import { describe, expect, it } from 'vitest'
import type { ChatDeposit, DepositProgress } from '../../../shared/ipc'
import { addressClosed, closesAt, depositAmount, depositChip, depositLine, depositWhere, timeLeft } from './deposit-card'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const card = (progress: Partial<DepositProgress> = {}, extra: Partial<ChatDeposit> = {}): ChatDeposit => ({
  id: 'd1',
  kind: 'intents',
  chain: 'base',
  chainName: 'Base',
  mark: 'base',
  asset: 'USDC',
  icon: null,
  amount: '25',
  address: '0x8f436D184823B77188DE973322278686c3780C2c',
  memo: null,
  min: '1',
  account: 'a'.repeat(64),
  closes: null,
  why: null,
  progress: { stage: 'watching', got: null, tx: null, link: null, until: NOW, ...progress },
  ...extra,
})

describe('a deposit card’s words', () => {
  it('counts down how long Ink still watches', () => {
    expect(timeLeft(NOW + 23 * 60 * 60_000 - 1, NOW)).toBe('23 h left')
    expect(timeLeft(NOW + 40 * 60_000, NOW)).toBe('40 min left')
    expect(timeLeft(NOW + 10_000, NOW)).toBe('under a minute left')
    expect(timeLeft(NOW - 1, NOW)).toBe('under a minute left')
  })

  it('shows what’s coming, then what arrived', () => {
    expect(depositAmount(card())).toBe('25 USDC')
    expect(depositAmount(card({}, { amount: null }))).toBe('USDC')
    expect(depositAmount(card({ stage: 'seen', got: '24.5 USDC' }))).toBe('24.5 USDC')
    expect(depositWhere(card())).toBe('sent on Base · lands in your Intents balance')
    expect(depositWhere(card({}, { kind: 'own' }))).toBe('sent on Base · to your own address')
  })

  it('names each stage on the chip, and only moving ones spin', () => {
    expect(depositChip(card())).toEqual({ text: 'Watching', tone: 'plan', moving: true })
    expect(depositChip(card({}, { kind: 'own' })).text).toBe('Watching your balance')
    expect(depositChip(card({ stage: 'seen' }))).toMatchObject({ text: 'On its way', moving: true })
    expect(depositChip(card({ stage: 'credited' }))).toMatchObject({ text: 'Arrived', tone: 'ok', moving: false })
    expect(depositChip(card({ stage: 'failed' }))).toMatchObject({ tone: 'block' })
    expect(depositChip(card({ stage: 'short' }))).toMatchObject({ text: 'Under the minimum', moving: true })
    expect(depositChip(card({ stage: 'refunded' }))).toMatchObject({ text: 'Refunded', moving: false })
  })

  it('says when NEAR Intents’ address closes, what a deposit under the minimum waits for, and that a refund is in the Intents balance', () => {
    const closes = NOW + 2 * 24 * 60 * 60_000
    const open = { closes }
    expect(addressClosed(card({}, open), NOW)).toBe(false)
    expect(addressClosed(card({}, open), closes)).toBe(true)
    expect(addressClosed(card({}, { kind: 'own', closes }), closes)).toBe(false)
    expect(depositLine(card({ stage: 'stopped' }, open), NOW)).toBe(`Nothing arrived in a day. The address stays open until ${closesAt(closes)}: anything sent before then lands in your Intents balance.`)
    expect(depositLine(card({ stage: 'stopped' }, open), closes)).toBe('Nothing arrived, and the address has closed: send nothing to it. Ask your agent for a new one.')
    expect(depositLine(card({ stage: 'stopped' }), NOW)).toContain('Ask your agent for a new address')
    expect(depositLine(card({ stage: 'short' }, open), NOW)).toBe(`That’s under NEAR Intents’ 1 USDC minimum, so it isn’t credited yet. Send the rest to this address before ${closesAt(closes)}, or it’s refunded into your Intents balance after that.`)
    expect(depositLine(card({ stage: 'short' }, open), closes)).toContain('the address has closed: NEAR Intents refunds it into your Intents balance')
    expect(depositLine(card({ stage: 'refunded' }))).toBe('NEAR Intents didn’t take it, likely under its 1 USDC minimum, and refunded it into your Intents balance.')
  })

  it('says what became of it, and whether the address still works once Ink stops', () => {
    expect(depositLine(card())).toBeNull()
    expect(depositLine(card({ stage: 'failed' }))).toContain('likely under its 1 USDC minimum')
    expect(depositLine(card({ stage: 'stopped' }, { kind: 'own' }))).toContain('The address still works')
    expect(depositLine(card({ stage: 'stopped', tx: '0xabc12345' }))).toContain('NEAR Intents still credits it')
    expect(depositLine(card({ stage: 'credited' }, { kind: 'own' }))).toBe('In your Base balance.')
    expect(depositLine(card({ stage: 'unwatched' }, { kind: 'own', chainName: 'Bitcoin' }))).toBe('Ink can’t watch Bitcoin balances yet. What arrives shows in Portfolio.')
  })
})
