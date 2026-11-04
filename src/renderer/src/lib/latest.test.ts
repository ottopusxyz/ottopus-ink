import { describe, expect, it } from 'vitest'
import { latestOnly } from './latest'

describe('latestOnly', () => {
  it('keeps a request current until the next one starts', () => {
    const begin = latestOnly()
    const first = begin()
    expect(first()).toBe(true)
    const second = begin()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })

  it('drops an older answer that arrives after a newer one', async () => {
    const begin = latestOnly()
    const shown: string[] = []
    const answer = async (text: string, delayMs: number) => {
      const current = begin()
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (current()) shown.push(text)
    }
    await Promise.all([answer('signed out, from the first check', 30), answer('ready, from Check again', 1)])
    expect(shown).toEqual(['ready, from Check again'])
  })
})
