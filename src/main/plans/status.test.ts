import { describe, expect, it } from 'vitest'
import { PLAN_STATUSES, type PlanStatus } from '../../shared/plan'
import { canTransition, effectiveStatus, isFinal, PLAN_TRANSITIONS } from './status'

const reachable = (from: PlanStatus): Set<PlanStatus> => {
  const seen = new Set<PlanStatus>([from])
  const queue = [from]
  while (queue.length) for (const next of PLAN_TRANSITIONS[queue.shift()!]) if (!seen.has(next) && seen.add(next)) queue.push(next)
  return seen
}

describe('plan statuses', () => {
  it('are the eight #15 lists, plus expired and blocked', () => {
    expect([...PLAN_STATUSES]).toEqual([
      'draft',
      'awaiting_review',
      'approved',
      'signing',
      'submitted',
      'confirmed',
      'failed',
      'cancelled',
      'expired',
      'blocked',
    ])
    expect(Object.keys(PLAN_TRANSITIONS).sort()).toEqual([...PLAN_STATUSES].sort())
  })

  it('never leave a final status', () => {
    for (const status of ['confirmed', 'failed', 'cancelled', 'expired', 'blocked'] as const) {
      expect(isFinal(status)).toBe(true)
      for (const to of PLAN_STATUSES) expect(canTransition(status, to)).toBe(false)
    }
    for (const status of ['draft', 'awaiting_review', 'approved', 'signing', 'submitted'] as const) expect(isFinal(status)).toBe(false)
  })

  it('reach approved only from review, and signing only from approved', () => {
    expect(PLAN_STATUSES.filter((from) => canTransition(from, 'approved'))).toEqual(['awaiting_review'])
    expect(PLAN_STATUSES.filter((from) => canTransition(from, 'signing'))).toEqual(['approved'])
  })

  it('can’t skip the review on the way to the signer', () => {
    expect(canTransition('draft', 'approved')).toBe(false)
    expect(canTransition('draft', 'signing')).toBe(false)
    expect(canTransition('awaiting_review', 'signing')).toBe(false)
  })

  it('let the chain alone decide once submitted, and can’t be cancelled once signing', () => {
    expect(PLAN_TRANSITIONS.submitted).toEqual(['confirmed', 'failed'])
    expect(canTransition('signing', 'cancelled')).toBe(false)
    expect(canTransition('submitted', 'cancelled')).toBe(false)
    expect(PLAN_STATUSES.filter((from) => canTransition(from, 'cancelled'))).toEqual(['draft', 'awaiting_review', 'approved'])
  })

  it('can all be reached from draft, and every path ends in a final status', () => {
    expect([...reachable('draft')].sort()).toEqual([...PLAN_STATUSES].sort())
    for (const status of PLAN_STATUSES) expect([...reachable(status)].some(isFinal)).toBe(true)
  })
})

describe('effectiveStatus', () => {
  const at = '2026-11-08T00:30:00.000Z'
  const before = new Date('2026-11-08T00:29:59.999Z')
  const after = new Date('2026-11-08T00:30:00.000Z')

  it('reads a plan past its time as expired, while it still waits on someone', () => {
    for (const status of ['draft', 'awaiting_review', 'approved'] as const) {
      expect(effectiveStatus(status, at, before)).toBe(status)
      expect(effectiveStatus(status, at, after)).toBe('expired')
    }
  })

  it('never expires a plan the signer or the chain has, or one already final', () => {
    for (const status of ['signing', 'submitted', 'confirmed', 'failed', 'cancelled', 'blocked'] as const) {
      expect(effectiveStatus(status, at, after)).toBe(status)
    }
  })
})
