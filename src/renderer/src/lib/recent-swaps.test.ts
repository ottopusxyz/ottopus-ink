import { describe, expect, it } from 'vitest'
import type { ChatSwap, RecentSwap } from '../../../shared/ipc'
import { homeSwaps, SETTLED_SHOWN_MS } from './recent-swaps'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const swap = (planId: string, stage: ChatSwap['stage'] | null, startedAt = NOW): RecentSwap => ({
  planId,
  send: '2 NEAR',
  get: 'USDC',
  where: 'on Base',
  progress: stage ? { stage, got: null, refunded: null, link: null } : null,
  startedAt,
})

describe('the swaps Home shows', () => {
  it('shows every swap under way, and settled ones only for a while', () => {
    const old = NOW - SETTLED_SHOWN_MS - 1
    const shown = homeSwaps([swap('new', null), swap('running', 'swapping', old), swap('done-lately', 'done'), swap('done-long-ago', 'done', old), swap('refunded-long-ago', 'refunded', old)], NOW)
    expect(shown.map((s) => s.planId)).toEqual(['new', 'running', 'done-lately'])
  })

  it('shows a few at most', () => {
    expect(homeSwaps([swap('a', null), swap('b', null), swap('c', null), swap('d', null)], NOW)).toHaveLength(3)
  })
})
