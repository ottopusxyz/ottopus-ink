import { describe, expect, it } from 'vitest'
import { nearBalance, STORAGE_YOCTO_PER_BYTE } from './balance'
import type { NearAccountView, NearRpc } from './rpc'

const ID = 'a'.repeat(64)
const NEAR = 10n ** 24n

/** An RPC that knows one account and some pool balances. */
function fakeRpc(view: NearAccountView | null, pools: Record<string, { staked: string; unstaked: string } | 'broken'> = {}) {
  const calls: string[] = []
  const rpc = {
    viewAccount: async () => view,
    callView: async (pool: string, method: string, args: { account_id: string }) => {
      calls.push(`${pool}.${method}(${args.account_id})`)
      const entry = pools[pool]
      if (!entry || entry === 'broken') throw new Error('no such pool')
      return method === 'get_account_staked_balance' ? entry.staked : entry.unstaked
    },
  } as unknown as NearRpc
  return { rpc, calls }
}

const index = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof globalThis.fetch

describe('a NEAR balance', () => {
  it('is zero and not on chain for an implicit account nothing was sent to yet', async () => {
    const { rpc } = fakeRpc(null)
    expect(await nearBalance(ID, { rpc, fetch: index({ pools: [] }) })).toEqual({
      accountId: ID,
      onChain: false,
      available: 0n,
      storage: 0n,
      staked: 0n,
      pools: [],
      stakingComplete: true,
    })
  })

  it('holds back what storage costs from what can be sent', async () => {
    const { rpc } = fakeRpc({ amount: 5n * NEAR, locked: 0n, storageUsage: 182n })
    const balance = await nearBalance(ID, { rpc, fetch: index({ pools: [] }) })
    expect(balance.storage).toBe(182n * STORAGE_YOCTO_PER_BYTE)
    expect(balance.available).toBe(5n * NEAR - 182n * STORAGE_YOCTO_PER_BYTE)
  })

  it('pays storage from a validator stake first', async () => {
    const { rpc } = fakeRpc({ amount: 5n * NEAR, locked: 100n * STORAGE_YOCTO_PER_BYTE, storageUsage: 182n })
    const balance = await nearBalance(ID, { rpc, fetch: index({ pools: [] }) })
    expect(balance.storage).toBe(82n * STORAGE_YOCTO_PER_BYTE)
    expect(balance.staked).toBe(100n * STORAGE_YOCTO_PER_BYTE)
  })

  it('never goes below zero when storage costs more than the balance', async () => {
    const { rpc } = fakeRpc({ amount: 1n, locked: 0n, storageUsage: 182n })
    expect(await nearBalance(ID, { rpc, fetch: index({ pools: [] }) })).toMatchObject({ available: 0n, storage: 1n })
  })

  it('adds up stakes read from each pool the index names, ignoring the index’s own numbers', async () => {
    const { rpc, calls } = fakeRpc({ amount: NEAR, locked: 0n, storageUsage: 0n }, {
      'one.poolv1.near': { staked: (2n * NEAR).toString(), unstaked: '0' },
      'two.pool.near': { staked: (3n * NEAR).toString(), unstaked: NEAR.toString() },
      'empty.pool.near': { staked: '0', unstaked: '0' },
    })
    const pools = [{ pool_id: 'one.poolv1.near', staked: '999' }, { pool_id: 'two.pool.near' }, { pool_id: 'empty.pool.near' }, { pool_id: 'one.poolv1.near' }]
    const balance = await nearBalance(ID, { rpc, fetch: index({ account_id: ID, pools }) })
    expect(balance.staked).toBe(5n * NEAR)
    expect(balance.pools).toEqual([
      { poolId: 'one.poolv1.near', staked: 2n * NEAR, unstaked: 0n },
      { poolId: 'two.pool.near', staked: 3n * NEAR, unstaked: NEAR },
    ])
    expect(balance.stakingComplete).toBe(true)
    expect(calls).toContain(`one.poolv1.near.get_account_staked_balance(${ID})`)
    expect(calls.filter((call) => call.startsWith('one.poolv1.near.get_account_staked'))).toHaveLength(1)
  })

  it('says staking may be incomplete when the index or a pool can’t be read', async () => {
    const view = { amount: NEAR, locked: 0n, storageUsage: 0n }
    expect((await nearBalance(ID, { rpc: fakeRpc(view).rpc, fetch: index({}, 503) })).stakingComplete).toBe(false)
    expect((await nearBalance(ID, { rpc: fakeRpc(view).rpc, fetch: index('nonsense') })).stakingComplete).toBe(false)
    const broken = fakeRpc(view, { 'one.pool.near': { staked: NEAR.toString(), unstaked: '0' }, 'bad.pool.near': 'broken' })
    const balance = await nearBalance(ID, { rpc: broken.rpc, fetch: index({ pools: [{ pool_id: 'one.pool.near' }, { pool_id: 'bad.pool.near' }] }) })
    expect(balance).toMatchObject({ staked: NEAR, stakingComplete: false })
  })

  it('skips pool ids that aren’t NEAR account ids, and pool answers that aren’t whole numbers', async () => {
    const { rpc, calls } = fakeRpc({ amount: NEAR, locked: 0n, storageUsage: 0n }, { 'odd.pool.near': { staked: '1.5', unstaked: '0' } })
    const balance = await nearBalance(ID, { rpc, fetch: index({ pools: [{ pool_id: '../../evil' }, { pool_id: 'odd.pool.near' }] }) })
    expect(calls.some((call) => call.includes('evil'))).toBe(false)
    expect(balance).toMatchObject({ staked: 0n, stakingComplete: false })
  })
})
