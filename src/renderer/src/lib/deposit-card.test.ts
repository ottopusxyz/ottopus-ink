import { describe, expect, it } from 'vitest'
import type { ChatDeposit, DepositProgress } from '../../../shared/ipc'
import { depositAmount, depositChip, depositLine, depositWhere, timeLeft } from './deposit-card'

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
  })

  it('says what became of it, and whether the address still works once Ink stops', () => {
    expect(depositLine(card())).toBeNull()
    expect(depositLine(card({ stage: 'failed' }))).toContain('likely under its 1 USDC minimum')
    expect(depositLine(card({ stage: 'stopped' }))).toContain('The address still works')
    expect(depositLine(card({ stage: 'stopped', tx: '0xabc12345' }))).toContain('NEAR Intents still credits it')
    expect(depositLine(card({ stage: 'credited' }, { kind: 'own' }))).toBe('In your Base balance.')
    expect(depositLine(card({ stage: 'unwatched' }, { kind: 'own', chainName: 'Bitcoin' }))).toBe('Ink can’t watch Bitcoin balances yet. What arrives shows in Portfolio.')
  })
})
