import { describe, expect, it } from 'vitest'
import type { SwapReport, SwapStage } from '../routes/one-click'
import { ADDRESS_LAST_MS, ADDRESS_MARGIN_MS, createAddressKeeper } from './address-keeper'
import type { DepositAddress } from './deposits'

const ACCOUNT = 'a'.repeat(64)
const USDC = { id: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', decimals: 6 }
const NOW = Date.parse('2026-11-19T10:00:00Z')
const DAY = 24 * 60 * 60_000

const report = (stage: SwapStage): SwapReport => ({ stage, amountOut: null, payoutTx: null, refunded: null, deposited: null, depositTx: null })

/** A keeper whose 1Click hands out numbered addresses open three days, and answers status from a map. */
function setup() {
  let clock = NOW
  let made = 0
  let up = true
  const stages = new Map<string, SwapStage | null>()
  const statusAsked: string[] = []
  const keeper = createAddressKeeper({
    ask: async (): Promise<DepositAddress | null> => {
      if (!up) return null
      made += 1
      const address = `0x${String(made).padStart(40, '0')}`
      stages.set(address, 'PENDING_DEPOSIT')
      return { address, memo: null, min: '0.15', until: clock + 3 * DAY }
    },
    status: async (address) => {
      statusAsked.push(address)
      const stage = stages.get(address)
      return stage ? report(stage) : null
    },
    now: () => clock,
  })
  return {
    keeper,
    stages,
    statusAsked,
    at: (ms: number) => (clock = NOW + ms),
    down: () => (up = false),
    get: () => keeper.address(ACCOUNT, USDC).then((kept) => kept?.address ?? null),
  }
}

const FIRST = `0x${'1'.padStart(40, '0')}`
const SECOND = `0x${'2'.padStart(40, '0')}`

describe('keeping a NEAR Intents deposit address', () => {
  it('gives the same address while nothing was sent to it and more than a day is left, asking 1Click each time', async () => {
    const { get, at, statusAsked } = setup()
    expect(await get()).toBe(FIRST)
    expect(statusAsked).toEqual([])
    expect(await get()).toBe(FIRST)
    expect(statusAsked).toEqual([FIRST])
    at(3 * DAY - ADDRESS_MARGIN_MS - 1)
    expect(await get()).toBe(FIRST)
  })

  it('keeps giving the address of a deposit under the minimum, since the rest goes there', async () => {
    const { get, stages } = setup()
    await get()
    stages.set(FIRST, 'INCOMPLETE_DEPOSIT')
    expect(await get()).toBe(FIRST)
  })

  it('gets a new one once less than a day is left', async () => {
    const { get, at } = setup()
    await get()
    at(3 * DAY - ADDRESS_MARGIN_MS)
    expect(await get()).toBe(SECOND)
  })

  it('gets a new one once a deposit at the kept one is under way or done, however it went', async () => {
    for (const stage of ['KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED'] as const) {
      const { get, stages } = setup()
      await get()
      stages.set(FIRST, stage)
      expect(await get()).toBe(SECOND)
    }
  })

  it('gets a new one when told something arrived, without waiting for 1Click', async () => {
    const { keeper, get } = setup()
    await get()
    keeper.forget(FIRST, null)
    expect(await get()).toBe(SECOND)
  })

  it('keeps showing an unused one when 1Click can’t give a new one, while hours are left, and none past that', async () => {
    const { get, at, down } = setup()
    await get()
    down()
    at(3 * DAY - ADDRESS_LAST_MS - 1)
    expect(await get()).toBe(FIRST)
    at(3 * DAY - ADDRESS_LAST_MS)
    expect(await get()).toBeNull()
  })

  it('asks where a memo address stands with its memo, and forgets it only with that memo', async () => {
    const asked: [string, string | null][] = []
    const clock = NOW
    const keeper = createAddressKeeper({
      ask: async () => ({ address: 'GDJ4JZXZELZD737NVFORH4PSSQDWFDZTKW3AIDKHYQG23ZXBPDGGQBJK', memo: '245055336', min: null, until: NOW + 3 * DAY }),
      status: async (address, memo) => {
        asked.push([address, memo])
        return report('PENDING_DEPOSIT')
      },
      now: () => clock,
    })
    await keeper.address(ACCOUNT, USDC)
    keeper.forget('GDJ4JZXZELZD737NVFORH4PSSQDWFDZTKW3AIDKHYQG23ZXBPDGGQBJK', '1')
    expect(await keeper.address(ACCOUNT, USDC)).toMatchObject({ memo: '245055336' })
    expect(asked).toEqual([['GDJ4JZXZELZD737NVFORH4PSSQDWFDZTKW3AIDKHYQG23ZXBPDGGQBJK', '245055336']])
  })

  it('shows none when 1Click can say neither where the kept one stands nor give a new one', async () => {
    const { get, down, stages } = setup()
    await get()
    stages.set(FIRST, null)
    down()
    expect(await get()).toBeNull()
  })
})
