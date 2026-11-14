import { describe, expect, it } from 'vitest'
import { whenMade } from './activity'

describe('when a plan was made', () => {
  it('is the time for today, and the day and time before', () => {
    const now = new Date(2026, 10, 14, 15, 0)
    expect(whenMade(new Date(2026, 10, 14, 9, 5).toISOString(), now)).not.toMatch(/Nov|14/)
    expect(whenMade(new Date(2026, 10, 12, 9, 5).toISOString(), now)).toMatch(/12/)
    expect(whenMade('not a date', now)).toBe('')
  })
})
