import { describe, expect, it } from 'vitest'
import { lastGood } from './last-good'

/** A read whose answers the test hands out one by one. */
function reads<T>() {
  const pending: ((value: T | null) => void)[] = []
  let calls = 0
  return {
    read: () => (calls++, new Promise<T | null>((resolve) => pending.push(resolve))),
    answer: (value: T | null) => pending.shift()?.(value),
    get calls() {
      return calls
    },
  }
}

describe('a list kept from its last good read', () => {
  it('waits for the first read, and shares it between callers', async () => {
    const source = reads<string[]>()
    const list = lastGood(source.read, { maxAgeMs: 1000, now: () => 0 })
    const first = list()
    const second = list()
    expect(source.calls).toBe(1)
    source.answer(['USDC'])
    expect(await first).toEqual(['USDC'])
    expect(await second).toEqual(['USDC'])
  })

  it('reuses a fresh copy without reading again', async () => {
    let time = 0
    const source = reads<string[]>()
    const list = lastGood(source.read, { maxAgeMs: 1000, now: () => time })
    const first = list()
    source.answer(['USDC'])
    await first
    time = 1000
    expect(await list()).toEqual(['USDC'])
    expect(source.calls).toBe(1)
  })

  it('answers with the old copy at once while it reads again, then uses the new one', async () => {
    let time = 0
    const source = reads<string[]>()
    const list = lastGood(source.read, { maxAgeMs: 1000, now: () => time })
    const first = list()
    source.answer(['USDC'])
    await first
    time = 5000
    expect(await list()).toEqual(['USDC'])
    expect(source.calls).toBe(2)
    source.answer(['USDC', 'USDT'])
    await Promise.resolve()
    await Promise.resolve()
    expect(await list()).toEqual(['USDC', 'USDT'])
  })

  it('keeps the old copy when a later read fails or throws', async () => {
    let time = 0
    let next: () => Promise<string[] | null> = async () => ['USDC']
    const list = lastGood(() => next(), { maxAgeMs: 1000, now: () => time })
    expect(await list()).toEqual(['USDC'])
    time = 5000
    next = async () => null
    expect(await list()).toEqual(['USDC'])
    next = async () => {
      throw new Error('timed out')
    }
    expect(await list()).toEqual(['USDC'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await list()).toEqual(['USDC'])
  })

  it('is null when nothing was ever read, and tries again next time', async () => {
    let answer: string[] | null = null
    const list = lastGood(async () => answer, { maxAgeMs: 1000, now: () => 0 })
    expect(await list()).toBeNull()
    answer = ['USDC']
    expect(await list()).toEqual(['USDC'])
  })
})
