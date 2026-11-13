import { describe, expect, it } from 'vitest'
import type { ChatSwap, RecentSwap } from '../../../shared/ipc'
import { homeSwaps } from './recent-swaps'

const swap = (planId: string, stage: ChatSwap['stage'] | null): RecentSwap => ({
  planId,
  send: '2 NEAR',
  get: 'USDC',
  where: 'on Base',
  progress: stage ? { stage, got: null, refunded: null, link: null } : null,
  startedAt: Date.parse('2026-11-13T12:00:00Z'),
})

describe('the swaps Home shows', () => {
  it('shows only swaps still under way, and none once they settle', () => {
    const shown = homeSwaps([swap('new', null), swap('picking-up', 'deposited'), swap('running', 'swapping'), swap('done', 'done'), swap('refunded', 'refunded'), swap('failed', 'failed'), swap('unknown', 'unknown')])
    expect(shown.map((s) => s.planId)).toEqual(['new', 'picking-up', 'running'])
  })

  it('shows a few at most', () => {
    expect(homeSwaps([swap('a', null), swap('b', null), swap('c', null), swap('d', null)])).toHaveLength(3)
  })
})
