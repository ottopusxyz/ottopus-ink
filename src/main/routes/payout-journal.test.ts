import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlanSwap } from '../../shared/plan'
import type { SecretBox } from '../external/sign-ins'
import { createPayoutJournal, PAYOUT_MAX_AGE_MS, type HeldPayout } from './payout-journal'

const box: SecretBox = { canKeep: () => true, seal: (text) => Buffer.from(text).reverse(), open: (data) => Buffer.from(data).reverse().toString() }
const NOW = Date.parse('2026-11-14T10:00:00Z')
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const fileIn = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ink-payouts-'))
  dirs.push(dir)
  return join(dir, 'payouts.bin')
}
const entry = (planId: string, extra: Partial<HeldPayout> = {}): HeldPayout => ({
  planId,
  signed: 'ab'.repeat(40),
  transactionId: 'NearTx3333',
  keyId: `${'a'.repeat(64)} ed25519:Abc`,
  nonce: '43',
  blockHeight: '1000',
  step: 2,
  swap: 2,
  legIds: [`${planId}#0`, `${planId}#1`],
  payout: { role: 'payout', depositAddress: 'e'.repeat(64), amountOut: '15000000' } as PlanSwap,
  heldAt: NOW,
  ...extra,
})

describe('the payout journal', () => {
  it('keeps held payouts sealed across restarts, and forgets one once it’s sent or dropped', () => {
    const file = fileIn()
    const journal = createPayoutJournal({ file, box, now: () => NOW })
    journal.put(entry('p1'))
    journal.put(entry('p2'))
    expect(readFileSync(file).toString()).not.toContain('NearTx3333')
    expect(createPayoutJournal({ file, box, now: () => NOW }).list().map((kept) => kept.planId)).toEqual(['p2', 'p1'])
    journal.remove('p1')
    expect(createPayoutJournal({ file, box, now: () => NOW }).list().map((kept) => kept.planId)).toEqual(['p2'])
  })

  it('drops one past the time its transaction could land, and anything not in its shape', () => {
    const file = fileIn()
    const journal = createPayoutJournal({ file, box, now: () => NOW })
    journal.put(entry('old', { heldAt: NOW - PAYOUT_MAX_AGE_MS - 1 }))
    journal.put(entry('odd', { signed: 'not hex' }))
    journal.put(entry('ok'))
    expect(createPayoutJournal({ file, box, now: () => NOW }).list().map((kept) => kept.planId)).toEqual(['ok'])
  })
})
